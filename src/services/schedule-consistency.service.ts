import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { isoToSql } from "./smart.service.js";

/** Every participating schedule writer MUST take the same owner row lock first. */
export async function lockScheduleOwner(connection: PoolConnection, ownerId: number): Promise<boolean> {
  const [rows] = await connection.execute<(RowDataPacket & { idPengguna: number })[]>(
    "SELECT idPengguna FROM Pengguna WHERE idPengguna = ? FOR UPDATE", [ownerId],
  );
  return rows.length === 1;
}

export class ScheduleConsistencyConflict extends Error {
  constructor(public readonly code: "REMINDER_REVIEW_REQUIRED" | "REMINDER_SHIFT_PAST") {
    super(code === "REMINDER_REVIEW_REQUIRED"
      ? "Active reminder cannot be safely moved; review or cancel it first"
      : "Rescheduling would move a reminder into the past; review or cancel it first");
  }
}

export type Shift = { triggerAt: string; expiresAt: string | null };
// parseAktivitas uses UTC SQL DATETIME without a zone; Date.parse would treat
// that string as machine-local time on many systems (including Windows).
export const utcMs = (value: string): number => Date.parse(
  /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value.replace(" ", "T") + "Z",
);
export function shiftReminderTime(
  triggerAt: string, expiresAt: string | null,
  originalStart: string | null, nextStart: string | null,
  nowMs = Date.now(),
): Shift {
  if (!originalStart || !nextStart) throw new ScheduleConsistencyConflict("REMINDER_REVIEW_REQUIRED");
  const deltaMs = utcMs(nextStart) - utcMs(originalStart);
  const newTrigger = utcMs(triggerAt) + deltaMs;
  if (!Number.isFinite(deltaMs) || !Number.isFinite(newTrigger) || newTrigger <= nowMs) {
    throw new ScheduleConsistencyConflict("REMINDER_SHIFT_PAST");
  }
  const newExpiry = expiresAt === null ? null : utcMs(expiresAt) + deltaMs;
  if (newExpiry !== null && (!Number.isFinite(newExpiry) || newExpiry <= newTrigger)) {
    throw new ScheduleConsistencyConflict("REMINDER_SHIFT_PAST");
  }
  return { triggerAt: new Date(newTrigger).toISOString().slice(0, 19) + "Z",
    expiresAt: newExpiry === null ? null : new Date(newExpiry).toISOString().slice(0, 19) + "Z" };
}

type ActiveReminder = RowDataPacket & {
  idReminder: number;
  status: "PENDING" | "DUE";
  triggerAt: string;
  expiresAt: string | null;
};

/** Call only inside a transaction, after lockScheduleOwner, BEFORE writing Aktivitas.
 * All pending reminders shift by the activity start-time delta; DUE requires manual review.
 * Throws before mutating when any reminder would end in the past (all-or-nothing).
 */
export async function shiftActiveReminders(
  connection: PoolConnection, activityId: number,
  originalStart: string | null, nextStart: string | null,
): Promise<number> {
  if (originalStart === nextStart || (originalStart && nextStart && utcMs(originalStart) === utcMs(nextStart))) return 0;
  const [rows] = await connection.execute<ActiveReminder[]>(
    `SELECT idReminder, status,
      DATE_FORMAT(triggerAt, '%Y-%m-%dT%H:%i:%sZ') AS triggerAt,
      DATE_FORMAT(expiresAt, '%Y-%m-%dT%H:%i:%sZ') AS expiresAt
     FROM activity_reminders WHERE idAktivitas = ? AND status IN ('PENDING','DUE')
     ORDER BY idReminder FOR UPDATE`, [activityId],
  );
  if (!rows.length) return 0;
  if (rows.some((row) => row.status !== "PENDING")) {
    throw new ScheduleConsistencyConflict("REMINDER_REVIEW_REQUIRED");
  }
  const now = Date.now();
  const updates = rows.map((row) => ({ id: row.idReminder,
    ...shiftReminderTime(row.triggerAt, row.expiresAt, originalStart, nextStart, now) }));
  for (const update of updates) {
    await connection.execute(
      `UPDATE activity_reminders
       SET triggerAt = ?, expiresAt = ?, revision = revision + 1,
           updatedAt = UTC_TIMESTAMP(6)
       WHERE idReminder = ? AND status = 'PENDING'`,
      [isoToSql(update.triggerAt), update.expiresAt === null ? null : isoToSql(update.expiresAt), update.id],
    );
  }
  return updates.length;
}
