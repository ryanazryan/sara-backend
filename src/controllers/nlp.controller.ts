import { createHash, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from "../config/database.js";
import { interpretIndonesian, type Draft } from "../services/nlp.service.js";
import {
  parseNlpRequest, parseConfirmRequest, validInterpretationId,
} from "../validators/nlp.validators.js";

type InterpretationRow = RowDataPacket & {
  idInterpretation: string;
  state: "READY" | "NEEDS_CLARIFICATION" | "CONFIRMED";
  intent: string;
  structuredDraft: Draft | string;
  missingFields: string[] | string;
  issues: string[] | string;
  timeZone: string;
  referenceAt: string;
  expiresAt: string;
  confirmedHash: string | null;
  resultJson: unknown;
};
type ActivityRow = RowDataPacket & {
  idAktivitas: number;
  idKegiatan: number | null;
  namaAktivitas: string;
  waktuMulai: string | null;
  waktuSelesai: string | null;
  kategori: string | null;
  prioritas: string | null;
  lokasi: string | null;
  status: string;
};
type OwnedRow = RowDataPacket & { found: number };
const owner = (res: Response): number => res.locals.authUserId as number;
const toSql = (value: string): string => value.replace("T", " ").replace("Z", "").slice(0, 19);
const asJson = <T>(value: T | string): T => typeof value === "string" ? JSON.parse(value) as T : value;
const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const selectColumns = `idInterpretation, intent, state, structuredDraft, missingFields, issues, timeZone,
  DATE_FORMAT(referenceAt, '%Y-%m-%dT%H:%i:%s.%fZ') AS referenceAt,
  DATE_FORMAT(expiresAt, '%Y-%m-%dT%H:%i:%s.%fZ') AS expiresAt,
  confirmedHash, resultJson`;
const activityColumns = `idAktivitas, idKegiatan, namaAktivitas,
  DATE_FORMAT(waktuMulai, '%Y-%m-%dT%H:%i:%sZ') AS waktuMulai,
  DATE_FORMAT(waktuSelesai, '%Y-%m-%dT%H:%i:%sZ') AS waktuSelesai,
  kategori, prioritas, lokasi, status`;

function exposed(row: InterpretationRow): Record<string, unknown> {
  const state = row.state !== "CONFIRMED" && Date.parse(row.expiresAt) <= Date.now() ? "EXPIRED" : row.state;
  return {
    id: row.idInterpretation,
    intent: row.intent,
    state,
    structuredDraft: asJson<Draft>(row.structuredDraft),
    missingFields: asJson<string[]>(row.missingFields),
    issues: asJson<string[]>(row.issues),
    referenceAt: row.referenceAt,
    timeZone: row.timeZone,
    expiresAt: row.expiresAt,
    ...(row.state === "CONFIRMED" ? { result: asJson<unknown>(row.resultJson as string) } : {}),
  };
}

export async function parseNaturalLanguage(req: Request, res: Response): Promise<void> {
  const checked = parseNlpRequest(req.body);
  if (!checked.ok) {
    res.status(422).json({ success: false, message: checked.message });
    return;
  }
  const now = new Date();
  const data = interpretIndonesian(checked.data.text, checked.data.timeZone, now);
  if (!data) {
    res.status(422).json({ success: false, code: "INTENT_UNSUPPORTED",
      message: "Unsupported command. Try 'buat aktivitas ...' or 'ingatkan saya ...'." });
    return;
  }
  const id = randomUUID();
  const expires = new Date(now.getTime() + 15 * 60 * 1000);
  await pool.execute<ResultSetHeader>(
    `INSERT INTO nlp_interpretations
     (idInterpretation, idPengguna, intent, state, structuredDraft, missingFields, issues,
      timeZone, referenceAt, expiresAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, owner(res), data.intent, data.state, JSON.stringify(data.structuredDraft),
      JSON.stringify(data.missingFields), JSON.stringify(data.issues),
      checked.data.timeZone, toSql(now.toISOString()), toSql(expires.toISOString())],
  );
  res.status(200).json({ success: true, data: {
    id, intent: data.intent, state: data.state, structuredDraft: data.structuredDraft,
    missingFields: data.missingFields, issues: data.issues, referenceAt: data.referenceAt,
    timeZone: data.timeZone, expiresAt: expires.toISOString(),
  } });
}

async function findOwned(id: string, idPengguna: number): Promise<InterpretationRow | null> {
  const [rows] = await pool.execute<InterpretationRow[]>(
    `SELECT ${selectColumns} FROM nlp_interpretations
     WHERE idInterpretation = ? AND idPengguna = ? LIMIT 1`, [id, idPengguna],
  );
  return rows[0] ?? null;
}

export async function readInterpretation(req: Request, res: Response): Promise<void> {
  if (!validInterpretationId(req.params.id)) {
    res.status(422).json({ success: false, message: "Invalid interpretation ID" });
    return;
  }
  const row = await findOwned(req.params.id, owner(res));
  if (!row) {
    res.status(404).json({ success: false, message: "Interpretation not found" });
    return;
  }
  res.json({ success: true, data: exposed(row) });
}

export async function confirmInterpretation(req: Request, res: Response): Promise<void> {
  if (!validInterpretationId(req.params.id)) {
    res.status(422).json({ success: false, message: "Invalid interpretation ID" });
    return;
  }
  const checked = parseConfirmRequest(req.body);
  if (!checked.ok) {
    res.status(422).json({ success: false, message: checked.message });
    return;
  }
  const hash = sha(checked.data.overrides);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // MySQL row lock serializes concurrent confirm calls. No duplicate activity.
    const [rows] = await connection.execute<InterpretationRow[]>(
      `SELECT ${selectColumns} FROM nlp_interpretations
       WHERE idInterpretation = ? AND idPengguna = ? FOR UPDATE`,
      [req.params.id, owner(res)],
    );
    const row = rows[0];
    if (!row) {
      await connection.rollback();
      res.status(404).json({ success: false, message: "Interpretation not found" });
      return;
    }
    if (row.state === "CONFIRMED") {
      await connection.rollback();
      if (row.confirmedHash !== hash) {
        res.status(409).json({ success: false, code: "CONFIRM_PAYLOAD_CONFLICT",
          message: "Interpretation already confirmed with different overrides" });
        return;
      }
      res.json({ success: true, replayed: true, data: asJson<unknown>(row.resultJson as string) });
      return;
    }
    if (Date.parse(row.expiresAt) <= Date.now()) {
      await connection.rollback();
      res.status(409).json({ success: false, code: "DRAFT_EXPIRED", message: "Interpretation expired; parse the command again" });
      return;
    }
    if (row.state !== "READY") {
      await connection.rollback();
      res.status(409).json({ success: false, code: "DRAFT_NOT_READY", message: "Ambiguous command; rephrase and parse again" });
      return;
    }
    const original = asJson<Draft>(row.structuredDraft);
    const override = checked.data.overrides;
    if (original.reminderTriggerAt && override.waktuMulai !== undefined && override.reminderTriggerAt === undefined) {
      await connection.rollback();
      res.status(422).json({ success: false,
        message: "Changing activity time requires an explicit reminderTriggerAt override (or null)" });
      return;
    }
    const draft = { ...original, ...override };
    if (!draft.namaAktivitas || draft.namaAktivitas.trim().length > 200) {
      await connection.rollback();
      res.status(422).json({ success: false, message: "Invalid activity name" });
      return;
    }
    if (draft.waktuMulai && Date.parse(draft.waktuMulai) <= Date.now()) {
      await connection.rollback();
      res.status(422).json({ success: false, message: "Activity time must be in the future" });
      return;
    }
    if (draft.reminderTriggerAt && (!draft.waktuMulai || Date.parse(draft.reminderTriggerAt) <= Date.now())) {
      await connection.rollback();
      res.status(422).json({ success: false, message: "Reminder requires scheduled activity and future trigger" });
      return;
    }
    if (draft.idKegiatan !== null) {
      const [owned] = await connection.execute<OwnedRow[]>(
        `SELECT 1 AS found FROM Kegiatan WHERE idKegiatan = ? AND idPengguna = ? FOR UPDATE`,
        [draft.idKegiatan, owner(res)],
      );
      if (!owned.length) {
        await connection.rollback();
        res.status(422).json({ success: false, message: "idKegiatan does not belong to current user" });
        return;
      }
    }
    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT INTO Aktivitas (idPengguna, idKegiatan, namaAktivitas, waktuMulai, status)
       VALUES (?, ?, ?, ?, 'TO DO')`,
      [owner(res), draft.idKegiatan, draft.namaAktivitas, draft.waktuMulai ? toSql(draft.waktuMulai) : null],
    );
    let reminderId: number | null = null;
    if (draft.reminderTriggerAt) {
      const [r] = await connection.execute<ResultSetHeader>(
        `INSERT INTO activity_reminders (idAktivitas, triggerAt, expiresAt, status, createdAt, updatedAt)
         VALUES (?, ?, NULL, 'PENDING', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
        [inserted.insertId, toSql(draft.reminderTriggerAt)],
      );
      reminderId = r.insertId;
    }
    const [activities] = await connection.execute<ActivityRow[]>(
      `SELECT ${activityColumns} FROM Aktivitas WHERE idAktivitas = ? AND idPengguna = ?`,
      [inserted.insertId, owner(res)],
    );
    const result = { interpretationId: row.idInterpretation,
      activity: activities[0], reminder: reminderId === null ? null : { idReminder: reminderId,
        idAktivitas: inserted.insertId, triggerAt: draft.reminderTriggerAt, status: "PENDING" } };
    await connection.execute(
      `UPDATE nlp_interpretations SET state = 'CONFIRMED', confirmedAt = UTC_TIMESTAMP(6),
       confirmedHash = ?, resultJson = ? WHERE idInterpretation = ? AND idPengguna = ?`,
      [hash, JSON.stringify(result), row.idInterpretation, owner(res)],
    );
    await connection.commit();
    res.status(201).json({ success: true, replayed: false, data: result });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
