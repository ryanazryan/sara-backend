import type { Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import pool from "../config/database.js";
import { parsePagination } from "../validators/activity.validators.js";

type NotificationRow = RowDataPacket & {
  idNotification: number; idReminder: number; idAktivitas: number;
  reminderRevision: number; status: string; attempts: number;
  providerMessageId: string | null; lastErrorCode: string | null;
  createdAt: string; updatedAt: string;
};
const fields = `n.idNotification, n.idReminder, r.idAktivitas, n.reminderRevision,
  n.status, n.attempts, n.providerMessageId, n.lastErrorCode,
  DATE_FORMAT(n.createdAt, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,
  DATE_FORMAT(n.updatedAt, '%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt`;
export async function listNotifications(req: Request, res: Response): Promise<void> {
  const parsed = parsePagination(req.query);
  if (!parsed.ok) { res.status(422).json({ success: false, message: parsed.message }); return; }
  const { limit, offset } = parsed.data;
  const [rows] = await pool.execute<NotificationRow[]>(
    `SELECT ${fields} FROM notification_deliveries n
     JOIN notification_devices d ON d.idDevice = n.idDevice
     JOIN activity_reminders r ON r.idReminder = n.idReminder
     WHERE d.idPengguna = ? ORDER BY n.idNotification DESC LIMIT ? OFFSET ?`,
    [res.locals.authUserId as number, limit, offset]);
  res.json({ success: true, data: rows, pagination: { limit, offset, count: rows.length } });
}
