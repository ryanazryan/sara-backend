import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from "../config/database.js";
import { shiftActiveReminders, ScheduleConsistencyConflict } from "../services/schedule-consistency.service.js";
import {
  parsePriorityQuery, parseSmartConfirmation, parseSuggestionRequest, validSmartId,
} from "../validators/smart.validators.js";
import {
  findAvailableSlots, isoToSql, priorityScore, snapshotFingerprint,
  type ScheduledItem, type Slot, type TargetSnapshot,
} from "../services/smart.service.js";

type TargetRow = RowDataPacket & TargetSnapshot;
type BusyRow = RowDataPacket & ScheduledItem;
type CountRow = RowDataPacket & { found: number };
type SmartRow = RowDataPacket & {
  idSuggestion: string;
  idAktivitas: number;
  state: "READY" | "NO_SLOTS" | "APPLIED";
  originalFingerprint: string;
  optionsJson: Slot[] | string;
  contextJson: Record<string, unknown> | string;
  selectedIndex: number | null;
  resultJson: Record<string, unknown> | string | null;
  expiresAt: string;
  createdAt: string;
};
const idPengguna = (res: Response): number => res.locals.authUserId as number;
const json = <T>(input: T | string): T => typeof input === "string" ? JSON.parse(input) as T : input;
const timestamp = (value: string): string => value.replace("T", " ").replace("Z", "").slice(0, 19);

const targetColumns = `idAktivitas, namaAktivitas, idKegiatan,
  DATE_FORMAT(waktuMulai, '%Y-%m-%dT%H:%i:%sZ') AS waktuMulai,
  DATE_FORMAT(waktuSelesai, '%Y-%m-%dT%H:%i:%sZ') AS waktuSelesai,
  status, prioritas`;
const busyColumns = `idAktivitas, namaAktivitas,
  DATE_FORMAT(waktuMulai, '%Y-%m-%dT%H:%i:%sZ') AS waktuMulai,
  DATE_FORMAT(waktuSelesai, '%Y-%m-%dT%H:%i:%sZ') AS waktuSelesai`;
const suggestionColumns = `idSuggestion, idAktivitas, state, originalFingerprint,
  optionsJson, contextJson, selectedIndex, resultJson,
  DATE_FORMAT(expiresAt, '%Y-%m-%dT%H:%i:%s.%fZ') AS expiresAt,
  DATE_FORMAT(createdAt, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt`;

function expose(row: SmartRow): Record<string, unknown> {
  return {
    id: row.idSuggestion,
    activityId: row.idAktivitas,
    state: row.state !== "APPLIED" && Date.parse(row.expiresAt) <= Date.now() ? "EXPIRED" : row.state,
    availableSlots: json<Slot[]>(row.optionsJson),
    ...json<Record<string, unknown>>(row.contextJson),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    ...(row.state === "APPLIED" ? { selectedIndex: row.selectedIndex, result: row.resultJson ? json(row.resultJson) : null } : {}),
  };
}

export async function createSmartSuggestions(req: Request, res: Response): Promise<void> {
  const parsed = parseSuggestionRequest(req.body);
  if (!parsed.ok) { res.status(422).json({ success: false, message: parsed.message }); return; }
  const data = parsed.data;
  const [targets] = await pool.execute<TargetRow[]>(
    `SELECT ${targetColumns} FROM Aktivitas WHERE idAktivitas = ? AND idPengguna = ? LIMIT 1`,
    [data.activityId, idPengguna(res)],
  );
  const target = targets[0];
  if (!target) { res.status(404).json({ success: false, message: "Activity not found" }); return; }
  let durationMinutes = data.durationMinutes;
  if (durationMinutes === null && target.waktuMulai && target.waktuSelesai) {
    durationMinutes = (Date.parse(target.waktuSelesai) - Date.parse(target.waktuMulai)) / 60_000;
  }
  if (!durationMinutes || !Number.isSafeInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
    res.status(422).json({ success: false, message: "Provide durationMinutes 15-480 when activity has no usable interval" });
    return;
  }
  if (durationMinutes * 60_000 > Date.parse(data.windowEnd.replace(" ", "T") + "Z") - Date.parse(data.windowStart.replace(" ", "T") + "Z")) {
    res.status(422).json({ success: false, message: "Activity duration exceeds search window" }); return;
  }
  const [busy] = await pool.execute<BusyRow[]>(
    `SELECT ${busyColumns} FROM Aktivitas WHERE idPengguna = ? AND idAktivitas <> ?
     AND waktuMulai IS NOT NULL
     AND waktuMulai < DATE_ADD(?, INTERVAL ? MINUTE)
     AND COALESCE(waktuSelesai, DATE_ADD(waktuMulai, INTERVAL 15 MINUTE)) > DATE_SUB(?, INTERVAL ? MINUTE)
     ORDER BY waktuMulai ASC, idAktivitas ASC LIMIT 501`,
    [idPengguna(res), data.activityId, data.windowEnd, data.bufferMinutes, data.windowStart, data.bufferMinutes],
  );
  if (busy.length > 500) {
    res.status(409).json({ success: false, code: "SCHEDULE_TOO_LARGE", message: "Too many activities in the requested window; narrow the range" });
    return;
  }
  const [activeReminders] = await pool.execute<CountRow[]>(
    `SELECT 1 AS found FROM activity_reminders
     WHERE idAktivitas = ? AND status IN ('PENDING', 'DUE') LIMIT 1`, [data.activityId],
  );
  const from = data.windowStart.replace(" ", "T") + "Z";
  const to = data.windowEnd.replace(" ", "T") + "Z";
  const availableSlots = findAvailableSlots(from, to, durationMinutes, busy, data.bufferMinutes, data.maxSuggestions);
  const context = {
    existingSchedule: { startAt: target.waktuMulai, endAt: target.waktuSelesai },
    window: { from, to, durationMinutes, bufferMinutes: data.bufferMinutes },
    conflicts: busy,
    requiresReminderReview: activeReminders.length > 0,
    method: "earliest-free-15-minute-grid",
  };
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const createdAt = new Date().toISOString();
  await pool.execute<ResultSetHeader>(
    `INSERT INTO smart_assistance_suggestions
     (idSuggestion, idPengguna, idAktivitas, state, originalFingerprint, optionsJson, contextJson, createdAt, expiresAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?)`,
    [id, idPengguna(res), data.activityId, availableSlots.length ? "READY" : "NO_SLOTS",
      snapshotFingerprint(target), JSON.stringify(availableSlots), JSON.stringify(context), timestamp(expiresAt)],
  );
  res.status(201).json({ success: true, data: {
    id, activityId: data.activityId, state: availableSlots.length ? "READY" : "NO_SLOTS",
    availableSlots, ...context, createdAt, expiresAt,
  } });
}

export async function readSmartSuggestion(req: Request, res: Response): Promise<void> {
  if (!validSmartId(req.params.id)) {
    res.status(422).json({ success: false, message: "Invalid suggestion ID" }); return;
  }
  const [rows] = await pool.execute<SmartRow[]>(
    `SELECT ${suggestionColumns} FROM smart_assistance_suggestions
     WHERE idSuggestion = ? AND idPengguna = ? LIMIT 1`, [req.params.id, idPengguna(res)],
  );
  if (!rows.length) { res.status(404).json({ success: false, message: "Suggestion not found" }); return; }
  res.json({ success: true, data: expose(rows[0]) });
}

export async function confirmSmartSuggestion(req: Request, res: Response): Promise<void> {
  if (!validSmartId(req.params.id)) {
    res.status(422).json({ success: false, message: "Invalid suggestion ID" }); return;
  }
  const parsed = parseSmartConfirmation(req.body);
  if (!parsed.ok) { res.status(422).json({ success: false, message: parsed.message }); return; }
  const { slotIndex } = parsed.data;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Serialize Smart Assistance confirmations for this user. Other CRUD APIs
    // are not part of the lock protocol; live conflicts are checked again.
    const [users] = await connection.execute<CountRow[]>(
      "SELECT 1 AS found FROM Pengguna WHERE idPengguna = ? FOR UPDATE", [idPengguna(res)],
    );
    if (!users.length) { await connection.rollback(); res.status(404).json({ success: false, message: "User not found" }); return; }
    const [rows] = await connection.execute<SmartRow[]>(
      `SELECT ${suggestionColumns} FROM smart_assistance_suggestions
       WHERE idSuggestion = ? AND idPengguna = ? FOR UPDATE`, [req.params.id, idPengguna(res)],
    );
    const row = rows[0];
    if (!row) { await connection.rollback(); res.status(404).json({ success: false, message: "Suggestion not found" }); return; }
    if (row.state === "APPLIED") {
      await connection.rollback();
      if (row.selectedIndex !== slotIndex) {
        res.status(409).json({ success: false, code: "ALREADY_APPLIED", message: "Suggestion already applied with another slot" }); return;
      }
      res.json({ success: true, replayed: true, data: row.resultJson ? json(row.resultJson) : null }); return;
    }
    if (Date.parse(row.expiresAt) <= Date.now()) {
      await connection.rollback(); res.status(409).json({ success: false, code: "SUGGESTION_EXPIRED", message: "Suggestion expired; request a new analysis" }); return;
    }
    if (row.state !== "READY") {
      await connection.rollback(); res.status(409).json({ success: false, code: "NO_SLOTS", message: "No available slots to apply" }); return;
    }
    const options = json<Slot[]>(row.optionsJson);
    const slot = options[slotIndex];
    if (!slot) { await connection.rollback(); res.status(422).json({ success: false, message: "Selected slot does not exist" }); return; }
    if (Date.parse(slot.startAt) <= Date.now()) {
      await connection.rollback(); res.status(409).json({ success: false, code: "SLOT_PAST", message: "Suggested slot is now in the past" }); return;
    }
    const [targets] = await connection.execute<TargetRow[]>(
      `SELECT ${targetColumns} FROM Aktivitas
       WHERE idAktivitas = ? AND idPengguna = ? FOR UPDATE`, [row.idAktivitas, idPengguna(res)],
    );
    if (!targets.length) {
      await connection.rollback(); res.status(404).json({ success: false, message: "Activity not found" }); return;
    }
    if (snapshotFingerprint(targets[0]) !== row.originalFingerprint) {
      await connection.rollback(); res.status(409).json({ success: false, code: "ACTIVITY_CHANGED", message: "Activity changed since analysis; refresh suggestions" }); return;
    }
    const context = json<Record<string, unknown>>(row.contextJson);
    const configuredGap = (context.window as { bufferMinutes?: unknown } | undefined)?.bufferMinutes;
    if (typeof configuredGap !== "number" || !Number.isSafeInteger(configuredGap) ||
        configuredGap < 0 || configuredGap > 120) {
      await connection.rollback();
      res.status(409).json({ success: false, code: "INVALID_SUGGESTION", message: "Suggestion context is invalid" });
      return;
    }
    const gap = configuredGap;
    const start = isoToSql(slot.startAt);
    const end = isoToSql(slot.endAt);
    const [conflicts] = await connection.execute<CountRow[]>(
      `SELECT 1 AS found FROM Aktivitas WHERE idPengguna = ? AND idAktivitas <> ?
       AND waktuMulai IS NOT NULL
       AND waktuMulai < DATE_ADD(?, INTERVAL ? MINUTE)
       AND COALESCE(waktuSelesai, DATE_ADD(waktuMulai, INTERVAL 15 MINUTE)) > DATE_SUB(?, INTERVAL ? MINUTE)
       LIMIT 1 FOR UPDATE`,
      [idPengguna(res), row.idAktivitas, end, gap, start, gap],
    );
    if (conflicts.length) {
      await connection.rollback(); res.status(409).json({ success: false, code: "SLOT_CONFLICT", message: "Schedule changed; requested slot is no longer free" }); return;
    }
    let shiftedReminders = 0;
    try {
      shiftedReminders = await shiftActiveReminders(connection, row.idAktivitas, targets[0].waktuMulai, slot.startAt);
    } catch (error) {
      if (!(error instanceof ScheduleConsistencyConflict)) throw error;
      await connection.rollback();
      res.status(409).json({ success: false, code: error.code, message: error.message }); return;
    }
    await connection.execute<ResultSetHeader>(
      `UPDATE Aktivitas SET waktuMulai = ?, waktuSelesai = ?
       WHERE idAktivitas = ? AND idPengguna = ?`,
      [start, end, row.idAktivitas, idPengguna(res)],
    );
    // Existing Activity update trigger records the modification in history.
    const result = { activityId: row.idAktivitas, startAt: slot.startAt, endAt: slot.endAt,
      remindersUpdated: shiftedReminders > 0, shiftedReminders, historyRecorded: true };
    await connection.execute<ResultSetHeader>(
      `UPDATE smart_assistance_suggestions SET state = 'APPLIED', selectedIndex = ?,
       resultJson = ?, appliedAt = UTC_TIMESTAMP(6) WHERE idSuggestion = ? AND idPengguna = ?`,
      [slotIndex, JSON.stringify(result), row.idSuggestion, idPengguna(res)],
    );
    await connection.commit();
    res.status(200).json({ success: true, replayed: false, data: result });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function listActivityPriorities(req: Request, res: Response): Promise<void> {
  const parsed = parsePriorityQuery(req.query);
  if (!parsed.ok) { res.status(422).json({ success: false, message: parsed.message }); return; }
  const [rows] = await pool.execute<(TargetRow)[]>(
    `SELECT ${targetColumns} FROM Aktivitas WHERE idPengguna = ?
     ORDER BY idAktivitas DESC LIMIT 501`, [idPengguna(res)],
  );
  if (rows.length > 500) {
    res.status(409).json({ success: false, code: "ACTIVITY_SET_TOO_LARGE", message: "Priority preview supports up to 500 activities" }); return;
  }
  const now = Date.now();
  const ranked = rows.map((item) => ({ ...item, ...priorityScore(item.prioritas, item.waktuMulai, now) }))
    .sort((a, b) => b.score - a.score || (a.waktuMulai ?? "9999").localeCompare(b.waktuMulai ?? "9999") || a.idAktivitas - b.idAktivitas);
  const { limit, offset } = parsed.data;
  res.json({ success: true, data: ranked.slice(offset, offset + limit),
    pagination: { limit, offset, count: ranked.slice(offset, offset + limit).length },
    methodology: "Heuristic: explicit priority text + scheduled start proximity; no auto-mutation or AI model" });
}
