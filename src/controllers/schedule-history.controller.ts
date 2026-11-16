import type { Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import pool from "../config/database.js";
import { updateAktivitas } from "./aktivitas.controller.js";
import { parseId, parsePagination } from "../validators/activity.validators.js";
import {
  parseConflictsRange,
  parseHistoryFilters,
  parseScheduleRange,
} from "../validators/schedule-history.validators.js";

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
type HistoryRow = RowDataPacket & {
  idHistory: number;
  idAktivitas: number;
  eventType: string;
  oldStatus: string | null;
  newStatus: string | null;
  changes: Record<string, unknown>;
  occurredAt: string;
};
type ExistsRow = RowDataPacket & { found: number };

const columns = `idAktivitas, idKegiatan, namaAktivitas,
  DATE_FORMAT(waktuMulai, '%Y-%m-%dT%H:%i:%sZ') AS waktuMulai,
  DATE_FORMAT(waktuSelesai, '%Y-%m-%dT%H:%i:%sZ') AS waktuSelesai,
  kategori, prioritas, lokasi, status`;
const historyColumns = `idHistory, idAktivitas, eventType, oldStatus, newStatus, changes,
  DATE_FORMAT(occurredAt, '%Y-%m-%dT%H:%i:%s.%fZ') AS occurredAt`;

function owner(res: Response): number {
  return res.locals.authUserId as number;
}

export async function listSchedule(req: Request, res: Response): Promise<void> {
  const parsed = parseScheduleRange(req.query);
  if (!parsed.ok) {
    res.status(422).json({ success: false, message: parsed.message });
    return;
  }
  const { from, to, limit, offset } = parsed.data;
  // Half-open [from, to); intervals overlap, start-only activities are points.
  const [rows] = await pool.execute<ActivityRow[]>(
    `SELECT ${columns} FROM Aktivitas
     WHERE idPengguna = ? AND waktuMulai IS NOT NULL AND waktuMulai < ?
       AND ((waktuSelesai IS NOT NULL AND waktuSelesai > ?)
         OR (waktuSelesai IS NULL AND waktuMulai >= ?))
     ORDER BY waktuMulai ASC, idAktivitas ASC LIMIT ? OFFSET ?`,
    [owner(res), to, from, from, limit, offset],
  );
  res.json({ success: true, data: rows, pagination: { limit, offset, count: rows.length },
    range: { from: `${from.replace(" ", "T")}Z`, to: `${to.replace(" ", "T")}Z` } });
}

export async function listScheduleConflicts(req: Request, res: Response): Promise<void> {
  const parsed = parseConflictsRange(req.query);
  if (!parsed.ok) {
    res.status(422).json({ success: false, message: parsed.message });
    return;
  }
  const { start, end, excludeActivityId } = parsed.data;
  const [rows] = await pool.execute<ActivityRow[]>(
    `SELECT ${columns} FROM Aktivitas
     WHERE idPengguna = ? AND waktuMulai IS NOT NULL AND waktuSelesai IS NOT NULL
       AND waktuMulai < ? AND waktuSelesai > ?
       AND (? IS NULL OR idAktivitas <> ?)
     ORDER BY waktuMulai ASC, idAktivitas ASC LIMIT 100`,
    [owner(res), end, start, excludeActivityId, excludeActivityId],
  );
  res.json({ success: true, data: { conflicts: rows } });
}

export async function listHistory(req: Request, res: Response): Promise<void> {
  const parsed = parseHistoryFilters(req.query);
  if (!parsed.ok) {
    res.status(422).json({ success: false, message: parsed.message });
    return;
  }
  const { activityId, eventType, limit, offset } = parsed.data;
  const [rows] = await pool.execute<HistoryRow[]>(
    `SELECT ${historyColumns} FROM aktivitas_history
     WHERE idPengguna = ? AND (? IS NULL OR idAktivitas = ?)
       AND (? IS NULL OR eventType = ?)
     ORDER BY idHistory DESC LIMIT ? OFFSET ?`,
    [owner(res), activityId, activityId, eventType, eventType, limit, offset],
  );
  res.json({ success: true, data: rows, pagination: { limit, offset, count: rows.length } });
}

export async function historyByActivity(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(422).json({ success: false, message: "Invalid Aktivitas ID" });
    return;
  }
  const paging = parsePagination(req.query);
  if (!paging.ok) {
    res.status(422).json({ success: false, message: paging.message });
    return;
  }
  const [exists] = await pool.execute<ExistsRow[]>(
    `SELECT 1 AS found FROM Aktivitas WHERE idAktivitas = ? AND idPengguna = ?
     UNION ALL
     SELECT 1 AS found FROM aktivitas_history WHERE idAktivitas = ? AND idPengguna = ? LIMIT 1`,
    [id, owner(res), id, owner(res)],
  );
  if (exists.length === 0) {
    res.status(404).json({ success: false, message: "Aktivitas not found" });
    return;
  }
  const { limit, offset } = paging.data;
  const [rows] = await pool.execute<HistoryRow[]>(
    `SELECT ${historyColumns} FROM aktivitas_history
     WHERE idAktivitas = ? AND idPengguna = ?
     ORDER BY idHistory DESC LIMIT ? OFFSET ?`,
    [id, owner(res), limit, offset],
  );
  res.json({ success: true, data: rows, pagination: { limit, offset, count: rows.length } });
}

// A separate endpoint for the mobile status action, reusing the existing
// activity validator/ownership checks. Lifecycle transitions remain team-open.
export async function setAktivitasStatus(req: Request, res: Response): Promise<void> {
  const body: unknown = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !("status" in body)) {
    res.status(422).json({ success: false, message: "Request must contain only status" });
    return;
  }
  await updateAktivitas(req, res);
}
