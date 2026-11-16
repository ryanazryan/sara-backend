import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from "../config/database.js";
import { parseId } from "../validators/activity.validators.js";
import { parseDeviceCreate, parseDevicePatch } from "../validators/notification.validators.js";

type DeviceRow = RowDataPacket & {
  idDevice: number; installationId: string; platform: string;
  notificationPermission: "GRANTED" | "DENIED" | "UNKNOWN";
  active: number; createdAt: string; updatedAt: string;
};
const fields = `idDevice, installationId, platform, notificationPermission, active,
  DATE_FORMAT(createdAt, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,
  DATE_FORMAT(updatedAt, '%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt`;
const owner = (res: Response): number => res.locals.authUserId as number;
const hashToken = (t: string | null): string | null => t === null ? null : createHash("sha256").update(t).digest("hex");
async function readDevice(id: number, idPengguna: number): Promise<DeviceRow | null> {
  const [rows] = await pool.execute<DeviceRow[]>(
    `SELECT ${fields} FROM notification_devices WHERE idDevice = ? AND idPengguna = ? LIMIT 1`, [id, idPengguna]);
  return rows[0] ?? null;
}
const duplicate = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";

export async function listDevices(_req: Request, res: Response): Promise<void> {
  const [rows] = await pool.execute<DeviceRow[]>(
    `SELECT ${fields} FROM notification_devices WHERE idPengguna = ? ORDER BY idDevice DESC LIMIT 100`, [owner(res)]);
  res.json({ success: true, data: rows });
}

export async function registerDevice(req: Request, res: Response): Promise<void> {
  const parsed = parseDeviceCreate(req.body);
  if (!parsed.ok) { res.status(422).json({ success: false, message: parsed.message }); return; }
  const d = parsed.data;
  const connection = await pool.getConnection();
  let id = 0;
  let created = false;
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute<(RowDataPacket & { idDevice: number })[]>(
      "SELECT idDevice FROM notification_devices WHERE idPengguna = ? AND installationId = ? FOR UPDATE",
      [owner(res), d.installationId]);
    if (existing.length) {
      id = existing[0].idDevice;
      await connection.execute(
        `UPDATE notification_devices SET platform = ?, notificationPermission = ?, fcmToken = ?,
         tokenHash = ?, active = 1, updatedAt = UTC_TIMESTAMP(6) WHERE idDevice = ? AND idPengguna = ?`,
        [d.platform, d.notificationPermission, d.fcmToken, hashToken(d.fcmToken), id, owner(res)]);
    } else {
      const [inserted] = await connection.execute<ResultSetHeader>(
        `INSERT INTO notification_devices (idPengguna, installationId, platform, notificationPermission,
         fcmToken, tokenHash, active, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
        [owner(res), d.installationId, d.platform, d.notificationPermission, d.fcmToken, hashToken(d.fcmToken)]);
      id = inserted.insertId;
      created = true;
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (duplicate(error)) { res.status(409).json({ success: false, message: "Device/token already registered" }); return; }
    throw error;
  } finally { connection.release(); }
  res.status(created ? 201 : 200).json({ success: true, data: await readDevice(id, owner(res)) });
}

export async function updateDevice(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  if (!id) { res.status(422).json({ success: false, message: "Invalid device ID" }); return; }
  const parsed = parseDevicePatch(req.body);
  if (!parsed.ok) { res.status(422).json({ success: false, message: parsed.message }); return; }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<(RowDataPacket & { notificationPermission: string; fcmToken: string | null })[]>(
      `SELECT notificationPermission, fcmToken FROM notification_devices
       WHERE idDevice = ? AND idPengguna = ? AND active = 1 FOR UPDATE`, [id, owner(res)]);
    if (!rows.length) { await connection.rollback(); res.status(404).json({ success: false, message: "Device not found" }); return; }
    const p = parsed.data.notificationPermission ?? rows[0].notificationPermission;
    if (parsed.data.fcmToken && p !== "GRANTED") {
      await connection.rollback();
      res.status(422).json({ success: false, message: "FCM token requires GRANTED permission" });
      return;
    }
    const token = p === "GRANTED" ? (parsed.data.fcmToken === undefined ? rows[0].fcmToken : parsed.data.fcmToken) : null;
    await connection.execute(
      `UPDATE notification_devices SET notificationPermission = ?, fcmToken = ?, tokenHash = ?,
       updatedAt = UTC_TIMESTAMP(6) WHERE idDevice = ? AND idPengguna = ?`,
      [p, token, hashToken(token), id, owner(res)]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (duplicate(error)) { res.status(409).json({ success: false, message: "Device/token already registered" }); return; }
    throw error;
  } finally { connection.release(); }
  res.json({ success: true, data: await readDevice(id, owner(res)) });
}

export async function unregisterDevice(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  if (!id) { res.status(422).json({ success: false, message: "Invalid device ID" }); return; }
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE notification_devices SET active = 0, notificationPermission = 'UNKNOWN',
     fcmToken = NULL, tokenHash = NULL, updatedAt = UTC_TIMESTAMP(6)
     WHERE idDevice = ? AND idPengguna = ? AND active = 1`, [id, owner(res)]);
  if (!result.affectedRows) { res.status(404).json({ success: false, message: "Device not found" }); return; }
  res.status(204).end();
}
