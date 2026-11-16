import type { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from "../config/database.js";
import { type NotificationSender, NotificationSendError, notificationSenderFromEnv } from "./notification-provider.service.js";
import { processDueReminders } from "./reminder.service.js";

const MAX_ATTEMPTS = 5;
const LEASE_SECONDS = 90;
type IdRow = RowDataPacket & { idNotification: number };
type DeliveryRow = RowDataPacket & {
  idNotification: number; idDevice: number; tokenHash: string | null; fcmToken: string | null;
  idReminder: number; idAktivitas: number; revision: number; reminderRevision: number;
  reminderStatus: string; deviceActive: number; notificationPermission: string;
  expiresAt: string | null; namaAktivitas: string;
};
export type DispatchReport = { due: number; expired: number; queued: number; accepted: number; retried: number; failed: number; skipped: number };

/** All times are compared by the MySQL server in UTC, not by device locale. */
export async function queueDueNotifications(): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT IGNORE INTO notification_deliveries
       (idReminder, idDevice, reminderRevision, status, attempts,
        nextAttemptAt, createdAt, updatedAt)
     SELECT r.idReminder, d.idDevice, r.revision, 'QUEUED', 0,
       UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)
     FROM activity_reminders r
     JOIN Aktivitas a ON a.idAktivitas = r.idAktivitas
     JOIN notification_devices d ON d.idPengguna = a.idPengguna
     WHERE r.status = 'DUE' AND r.dueAt IS NOT NULL
       AND (r.expiresAt IS NULL OR r.expiresAt > UTC_TIMESTAMP(6))
       AND r.dueAt > DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 24 HOUR)
       AND d.active = 1 AND d.notificationPermission = 'GRANTED'
       AND d.fcmToken IS NOT NULL AND d.tokenHash IS NOT NULL`,
  );
  return result.affectedRows;
}

async function reclaimAndSkip(): Promise<number> {
  // Recovery after crash: a leased job may be retried (at-least-once delivery).
  await pool.execute(
    `UPDATE notification_deliveries
     SET status = CASE WHEN attempts >= 5 THEN 'FAILED' ELSE 'RETRY' END,
         lastErrorCode = CASE WHEN attempts >= 5 THEN 'LEASE_ATTEMPTS_EXHAUSTED' ELSE lastErrorCode END,
         leaseUntil = NULL, nextAttemptAt = UTC_TIMESTAMP(6), updatedAt = UTC_TIMESTAMP(6)
     WHERE status = 'SENDING' AND leaseUntil < UTC_TIMESTAMP(6)`,
  );
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE notification_deliveries n
     JOIN activity_reminders r ON r.idReminder = n.idReminder
     JOIN notification_devices d ON d.idDevice = n.idDevice
     SET n.status = 'SKIPPED', n.leaseUntil = NULL, n.updatedAt = UTC_TIMESTAMP(6)
     WHERE n.status IN ('QUEUED', 'RETRY') AND
       (r.status <> 'DUE' OR r.revision <> n.reminderRevision
        OR (r.expiresAt IS NOT NULL AND r.expiresAt <= UTC_TIMESTAMP(6))
        OR r.dueAt <= DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 24 HOUR)
        OR d.active <> 1 OR d.notificationPermission <> 'GRANTED'
        OR d.fcmToken IS NULL OR d.tokenHash IS NULL)`,
  );
  return result.affectedRows;
}

async function claim(limit: number): Promise<DeliveryRow[]> {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [ids] = await c.query<IdRow[]>(
      `SELECT idNotification FROM notification_deliveries
       WHERE status IN ('QUEUED', 'RETRY') AND nextAttemptAt <= UTC_TIMESTAMP(6)
       ORDER BY nextAttemptAt ASC, idNotification ASC LIMIT ? FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    if (!ids.length) { await c.commit(); return []; }
    const placeholders = ids.map(() => "?").join(", ");
    const values = ids.map((x) => x.idNotification);
    await c.query(
      `UPDATE notification_deliveries
       SET status = 'SENDING', attempts = attempts + 1,
           leaseUntil = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ${LEASE_SECONDS} SECOND),
           updatedAt = UTC_TIMESTAMP(6)
       WHERE idNotification IN (${placeholders})`, values);
    const [rows] = await c.query<DeliveryRow[]>(
      `SELECT n.idNotification, n.idDevice, n.reminderRevision,
         d.fcmToken, d.tokenHash, d.active AS deviceActive, d.notificationPermission,
         r.idReminder, r.idAktivitas, r.revision, r.status AS reminderStatus,
         DATE_FORMAT(r.expiresAt, '%Y-%m-%dT%H:%i:%sZ') AS expiresAt,
         a.namaAktivitas
       FROM notification_deliveries n
       JOIN activity_reminders r ON r.idReminder = n.idReminder
       JOIN Aktivitas a ON a.idAktivitas = r.idAktivitas
       JOIN notification_devices d ON d.idDevice = n.idDevice
       WHERE n.idNotification IN (${placeholders})`, values);
    await c.commit();
    return rows;
  } catch (error) { await c.rollback(); throw error; } finally { c.release(); }
}

export async function dispatchNotifications(sender: NotificationSender = notificationSenderFromEnv(), batchSize = 50): Promise<DispatchReport> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 200) throw new Error("batchSize must be 1-200");
  const { due, expired } = await processDueReminders();
  const queued = await queueDueNotifications();
  let skipped = await reclaimAndSkip();
  let accepted = 0, retried = 0, failed = 0;
  for (const delivery of await claim(batchSize)) {
    if (delivery.reminderStatus !== "DUE" || delivery.revision !== delivery.reminderRevision ||
        delivery.deviceActive !== 1 || delivery.notificationPermission !== "GRANTED" ||
        !delivery.fcmToken || !delivery.tokenHash ||
        (delivery.expiresAt !== null && Date.parse(delivery.expiresAt) <= Date.now())) {
      await pool.execute(
        `UPDATE notification_deliveries SET status = 'SKIPPED', leaseUntil = NULL, updatedAt = UTC_TIMESTAMP(6)
         WHERE idNotification = ? AND status = 'SENDING'`, [delivery.idNotification]);
      skipped++;
      continue;
    }
    try {
      const providerMessageId = await sender({
        token: delivery.fcmToken, title: "Pengingat SARA", body: delivery.namaAktivitas,
        data: { reminderId: String(delivery.idReminder), aktivitasId: String(delivery.idAktivitas), notificationId: String(delivery.idNotification) },
      });
      await pool.execute(
        `UPDATE notification_deliveries SET status = 'ACCEPTED', providerMessageId = ?,
         leaseUntil = NULL, lastErrorCode = NULL, updatedAt = UTC_TIMESTAMP(6)
         WHERE idNotification = ? AND status = 'SENDING'`,
        [providerMessageId.slice(0, 255), delivery.idNotification]);
      accepted++;
    } catch (error) {
      const e = error instanceof NotificationSendError
        ? error : new NotificationSendError("UNKNOWN_PROVIDER_ERROR", true);
      const [attemptRows] = await pool.execute<(RowDataPacket & { attempts: number })[]>(
        "SELECT attempts FROM notification_deliveries WHERE idNotification = ? LIMIT 1", [delivery.idNotification]);
      const attempts = attemptRows[0]?.attempts ?? MAX_ATTEMPTS;
      const retry = e.retryable && attempts < MAX_ATTEMPTS;
      const delay = Math.min(1800, 30 * 2 ** Math.max(0, attempts - 1));
      await pool.execute(
        `UPDATE notification_deliveries SET status = ?, lastErrorCode = ?, leaseUntil = NULL,
         nextAttemptAt = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ? SECOND), updatedAt = UTC_TIMESTAMP(6)
         WHERE idNotification = ? AND status = 'SENDING'`,
        [retry ? "RETRY" : "FAILED", e.code.slice(0, 64), delay, delivery.idNotification]);
      if (e.invalidToken) {
        await pool.execute(
          `UPDATE notification_devices SET active = 0, fcmToken = NULL, tokenHash = NULL,
           updatedAt = UTC_TIMESTAMP(6) WHERE idDevice = ? AND tokenHash = ?`,
          [delivery.idDevice, delivery.tokenHash]);
      }
      if (retry) retried++; else failed++;
    }
  }
  return { due, expired, queued, accepted, retried, failed, skipped };
}
