import type { Request, Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from "../config/database.js";
import { lockScheduleOwner } from "../services/schedule-consistency.service.js";
import { parseId, parsePagination } from "../validators/activity.validators.js";
import { isFutureReminder, parseReminder, parseReminderList } from "../validators/reminder.validators.js";

type ReminderRow = RowDataPacket & {
  idReminder: number;
  idAktivitas: number;
  triggerAt: string;
  expiresAt: string | null;
  status: "PENDING" | "DUE" | "CANCELLED" | "EXPIRED";
  revision: number;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type ExistsRow = RowDataPacket & { found: number };

const reminderColumns = `r.idReminder, r.idAktivitas,
  DATE_FORMAT(r.triggerAt, '%Y-%m-%dT%H:%i:%sZ') AS triggerAt,
  DATE_FORMAT(r.expiresAt, '%Y-%m-%dT%H:%i:%sZ') AS expiresAt,
  r.status, r.revision,
  DATE_FORMAT(r.dueAt, '%Y-%m-%dT%H:%i:%s.%fZ') AS dueAt,
  DATE_FORMAT(r.createdAt, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,
  DATE_FORMAT(r.updatedAt, '%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt`;

const userId = (res: Response): number => res.locals.authUserId as number;

async function ownedActivity(id: number, owner: number): Promise<boolean> {
  const [rows] = await pool.execute<ExistsRow[]>(
    "SELECT 1 AS found FROM Aktivitas WHERE idAktivitas = ? AND idPengguna = ? LIMIT 1",
    [id, owner],
  );
  return rows.length > 0;
}

async function ownedReminder(id: number, owner: number): Promise<ReminderRow | null> {
  const [rows] = await pool.execute<ReminderRow[]>(
    `SELECT ${reminderColumns} FROM activity_reminders r
     JOIN Aktivitas a ON a.idAktivitas = r.idAktivitas
     WHERE r.idReminder = ? AND a.idPengguna = ? LIMIT 1`,
    [id, owner],
  );
  return rows[0] ?? null;
}

function asSqlDate(value: string): string {
  return value.replace("T", " ").replace("Z", "").slice(0, 19);
}

function invalidId(req: Request, res: Response): number | null {
  const id = parseId(req.params.id);
  if (id === null) res.status(422).json({ success: false, message: "Invalid ID" });
  return id;
}

export async function listReminders(req: Request, res: Response): Promise<void> {
  const parsed = parseReminderList(req.query);
  if (!parsed.ok) {
    res.status(422).json({ success: false, message: parsed.message });
    return;
  }
  const { status, limit, offset } = parsed.data;
  const [rows] = await pool.execute<ReminderRow[]>(
    `SELECT ${reminderColumns} FROM activity_reminders r
     JOIN Aktivitas a ON a.idAktivitas = r.idAktivitas
     WHERE a.idPengguna = ? AND (? IS NULL OR r.status = ?)
     ORDER BY r.idReminder DESC LIMIT ? OFFSET ?`,
    [userId(res), status, status, limit, offset],
  );
  res.json({ success: true, data: rows, pagination: { limit, offset, count: rows.length } });
}

export async function listActivityReminders(req: Request, res: Response): Promise<void> {
  const id = invalidId(req, res);
  if (id === null) return;
  const paging = parsePagination(req.query);
  if (!paging.ok) {
    res.status(422).json({ success: false, message: paging.message });
    return;
  }
  if (!(await ownedActivity(id, userId(res)))) {
    res.status(404).json({ success: false, message: "Aktivitas not found" });
    return;
  }
  const { limit, offset } = paging.data;
  const [rows] = await pool.execute<ReminderRow[]>(
    `SELECT ${reminderColumns} FROM activity_reminders r
     JOIN Aktivitas a ON a.idAktivitas = r.idAktivitas
     WHERE r.idAktivitas = ? AND a.idPengguna = ?
     ORDER BY r.idReminder DESC LIMIT ? OFFSET ?`,
    [id, userId(res), limit, offset],
  );
  res.json({ success: true, data: rows, pagination: { limit, offset, count: rows.length } });
}

export async function readReminder(req: Request, res: Response): Promise<void> {
  const id = invalidId(req, res);
  if (id === null) return;
  const row = await ownedReminder(id, userId(res));
  if (!row) {
    res.status(404).json({ success: false, message: "Reminder not found" });
    return;
  }
  res.json({ success: true, data: row });
}

export async function createReminder(req: Request, res: Response): Promise<void> {
  const id = invalidId(req, res);
  if (id === null) return;
  const parsed = parseReminder(req.body);
  if (!parsed.ok) {
    res.status(422).json({ success: false, message: parsed.message });
    return;
  }
  const triggerAt = parsed.data.triggerAt;
  const expiresAt = parsed.data.expiresAt ?? null;
  if (!triggerAt || !isFutureReminder(triggerAt, expiresAt)) {
    res.status(422).json({ success: false, message: "Reminder trigger must be in future and expiry must be later" });
    return;
  }
  const connection = await pool.getConnection();
  let idReminder: number;
  try {
    await connection.beginTransaction();
    if (!(await lockScheduleOwner(connection, userId(res)))) {
      await connection.rollback(); res.status(401).json({ success: false, message: "Invalid account" }); return;
    }
    const [owned] = await connection.execute<ExistsRow[]>(
      "SELECT 1 AS found FROM Aktivitas WHERE idAktivitas = ? AND idPengguna = ? FOR UPDATE",
      [id, userId(res)],
    );
    if (!owned.length) {
      await connection.rollback();
      res.status(404).json({ success: false, message: "Aktivitas not found" });
      return;
    }
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO activity_reminders
       (idAktivitas, triggerAt, expiresAt, status, createdAt, updatedAt)
       VALUES (?, ?, ?, 'PENDING', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [id, triggerAt, expiresAt],
    );
    idReminder = result.insertId;
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const row = await ownedReminder(idReminder, userId(res));
  res.status(201).json({ success: true, data: row });
}

export async function updateReminder(req: Request, res: Response): Promise<void> {
  const id = invalidId(req, res);
  if (id === null) return;
  const parsed = parseReminder(req.body, true);
  if (!parsed.ok) { res.status(422).json({ success: false, message: parsed.message }); return; }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (!(await lockScheduleOwner(connection, userId(res)))) {
      await connection.rollback(); res.status(401).json({ success: false, message: "Invalid account" }); return;
    }
    const [rows] = await connection.execute<ReminderRow[]>(
      `SELECT ${reminderColumns} FROM activity_reminders r
       JOIN Aktivitas a ON a.idAktivitas = r.idAktivitas
       WHERE r.idReminder = ? AND a.idPengguna = ? FOR UPDATE`, [id, userId(res)]);
    const existing = rows[0];
    if (!existing) {
      await connection.rollback(); res.status(404).json({ success: false, message: "Reminder not found" }); return;
    }
    if (existing.status !== "PENDING") {
      await connection.rollback(); res.status(409).json({ success: false, message: "Only PENDING reminders can be updated" }); return;
    }
    const triggerAt = parsed.data.triggerAt ?? asSqlDate(existing.triggerAt);
    const expiresAt = parsed.data.expiresAt === undefined
      ? (existing.expiresAt === null ? null : asSqlDate(existing.expiresAt)) : parsed.data.expiresAt;
    if (!isFutureReminder(triggerAt, expiresAt)) {
      await connection.rollback(); res.status(422).json({ success: false,
        message: "Reminder trigger must be in future and expiry must be later" }); return;
    }
    await connection.execute<ResultSetHeader>(
      `UPDATE activity_reminders SET triggerAt = ?, expiresAt = ?, revision = revision + 1,
       updatedAt = UTC_TIMESTAMP(6) WHERE idReminder = ? AND status = 'PENDING'`,
      [triggerAt, expiresAt, id]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  res.json({ success: true, data: await ownedReminder(id, userId(res)) });
}

export async function cancelReminder(req: Request, res: Response): Promise<void> {
  const id = invalidId(req, res);
  if (id === null) return;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (!(await lockScheduleOwner(connection, userId(res)))) {
      await connection.rollback(); res.status(401).json({ success: false, message: "Invalid account" }); return;
    }
    const [rows] = await connection.execute<ReminderRow[]>(
      `SELECT ${reminderColumns} FROM activity_reminders r
       JOIN Aktivitas a ON a.idAktivitas = r.idAktivitas
       WHERE r.idReminder = ? AND a.idPengguna = ? FOR UPDATE`, [id, userId(res)]);
    const existing = rows[0];
    if (!existing) {
      await connection.rollback(); res.status(404).json({ success: false, message: "Reminder not found" }); return;
    }
    if (existing.status === "CANCELLED") {
      await connection.rollback(); res.status(204).end(); return;
    }
    if (existing.status !== "PENDING" && existing.status !== "DUE") {
      await connection.rollback(); res.status(409).json({ success: false,
        message: "Reminder cannot be cancelled in current state" }); return;
    }
    await connection.execute<ResultSetHeader>(
      `UPDATE activity_reminders SET status = 'CANCELLED', revision = revision + 1,
       updatedAt = UTC_TIMESTAMP(6) WHERE idReminder = ?`, [id]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  res.status(204).end();
}
