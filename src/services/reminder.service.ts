import type { ResultSetHeader } from "mysql2";
import pool from "../config/database.js";

/**
 * Durable scheduler step. Moving PENDING -> DUE is atomic and idempotent.
 * DUE means eligible for a future notification dispatcher; NOT delivered.
 * This function intentionally makes no network calls to FCM.
 */
export async function processDueReminders(batchSize = 100): Promise<{
  expired: number;
  due: number;
}> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("batchSize must be an integer between 1 and 500");
  }
  // Expire both unprocessed and queued reminders before promoting new work.
  const [expired] = await pool.execute<ResultSetHeader>(
    `UPDATE activity_reminders
     SET status = 'EXPIRED', updatedAt = UTC_TIMESTAMP(6)
     WHERE status IN ('PENDING', 'DUE')
       AND expiresAt IS NOT NULL AND expiresAt <= UTC_TIMESTAMP(6)
     ORDER BY expiresAt ASC, idReminder ASC LIMIT 500`,
  );
  const [due] = await pool.execute<ResultSetHeader>(
    `UPDATE activity_reminders
     SET status = 'DUE', dueAt = UTC_TIMESTAMP(6), updatedAt = UTC_TIMESTAMP(6)
     WHERE status = 'PENDING' AND triggerAt <= UTC_TIMESTAMP(6)
       AND (expiresAt IS NULL OR expiresAt > UTC_TIMESTAMP(6))
     ORDER BY triggerAt ASC, idReminder ASC LIMIT ?`,
    [batchSize],
  );
  return { expired: expired.affectedRows, due: due.affectedRows };
}
