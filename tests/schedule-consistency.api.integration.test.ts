import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import app from "../src/app.js";
import pool from "../src/config/database.js";
import { issueAccessToken } from "../src/services/auth.service.js";

type Db = RowDataPacket & { db: string | null };
type Reminder = RowDataPacket & { idReminder: number; triggerAt: string; revision: number; status: string };
type Activity = RowDataPacket & { waktuMulai: string | null };
type Api = { success?: boolean; data?: Record<string, unknown>; code?: string; message?: string };
const date = (t: number) => new Date(t).toISOString().slice(0, 19) + "Z";

// Integration test is destructive, ALWAYS use the dedicated test DB.
test("concurrent activity writes and reminders stay consistent and owner isolated", async () => {
  const [db] = await pool.query<Db[]>("SELECT DATABASE() AS db");
  if (db[0]?.db !== "sara_migration_test") {
    await pool.end();
    throw new Error("Refusing to mutate any database other than sara_migration_test");
  }
  const owners: number[] = [];
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      if (server.listening) return resolve();
      server.once("listening", resolve); server.once("error", reject);
    });
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    async function call(method: string, path: string, token?: string, body?: unknown) {
      const res = await fetch(root + path, { method, headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: res.status, json: res.status === 204 ? null : await res.json() as Api };
    }
    async function makeUser() {
      const [result] = await pool.execute<ResultSetHeader>(
        "INSERT INTO Pengguna (nama,email,password,tanggalDaftar,emailVerifiedAt) VALUES (?,?,?,CURRENT_DATE(),UTC_TIMESTAMP())",
        ["Consistency Test", `${randomUUID()}@example.test`, "test-hash"]);
      owners.push(result.insertId);
      return result.insertId;
    }
    const a = await makeUser(); const b = await makeUser();
    const tokenA = await issueAccessToken(a); const tokenB = await issueAccessToken(b);
    const base = Math.ceil((Date.now() + 5 * 86_400_000) / 3_600_000) * 3_600_000;
    const initial = date(base);
    const activity = await call("POST", "/api/aktivitas", tokenA,
      { namaAktivitas: "Shiftable", waktuMulai: initial, waktuSelesai: date(base + 3_600_000) });
    assert.equal(activity.status, 201, JSON.stringify(activity.json));
    const activityId = Number(activity.json?.data?.idAktivitas);
    assert.ok(activityId > 0);
    const reminder = await call("POST", `/api/aktivitas/${activityId}/reminders`, tokenA,
      { triggerAt: date(base - 900_000), expiresAt: date(base + 300_000) });
    assert.equal(reminder.status, 201, JSON.stringify(reminder.json));
    const reminderId = Number(reminder.json?.data?.idReminder);
    assert.equal((await call("PATCH", `/api/aktivitas/${activityId}`, tokenB,
      { waktuMulai: date(base + 7_200_000) })).status, 404);

    // Both PATCHes compete for the same owner lock; the reminder must match
    // the final activity time regardless of which request commits last.
    const [first, second] = await Promise.all([
      call("PATCH", `/api/aktivitas/${activityId}`, tokenA,
        { waktuMulai: date(base + 3_600_000), waktuSelesai: date(base + 7_200_000) }),
      call("PATCH", `/api/aktivitas/${activityId}`, tokenA,
        { waktuMulai: date(base + 7_200_000), waktuSelesai: date(base + 10_800_000) }),
    ]);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(second.status, 200, JSON.stringify(second.json));
    const [acts] = await pool.execute<Activity[]>(
      "SELECT DATE_FORMAT(waktuMulai, '%Y-%m-%dT%H:%i:%sZ') AS waktuMulai FROM Aktivitas WHERE idAktivitas = ?", [activityId]);
    const [reminders] = await pool.execute<Reminder[]>(
      `SELECT idReminder, DATE_FORMAT(triggerAt, '%Y-%m-%dT%H:%i:%sZ') AS triggerAt, revision, status
       FROM activity_reminders WHERE idReminder = ?`, [reminderId]);
    assert.equal(Date.parse(reminders[0].triggerAt) - Date.parse(acts[0].waktuMulai as string), -900_000);
    assert.equal(reminders[0].revision, 3);
    assert.equal(reminders[0].status, "PENDING");

    const stale = await call("PATCH", `/api/aktivitas/${activityId}`, tokenA,
      { waktuMulai: date(Date.now() - 3_600_000) });
    assert.equal(stale.status, 409, JSON.stringify(stale.json));
    assert.equal(stale.json?.code, "REMINDER_SHIFT_PAST");
    const after = await call("GET", `/api/aktivitas/${activityId}`, tokenA);
    assert.equal(after.json?.data?.waktuMulai, acts[0].waktuMulai);

    await pool.execute("UPDATE activity_reminders SET status = 'DUE' WHERE idReminder = ?", [reminderId]);
    const due = await call("PATCH", `/api/aktivitas/${activityId}`, tokenA,
      { waktuMulai: date(base + 10_800_000) });
    assert.equal(due.status, 409, JSON.stringify(due.json));
    assert.equal(due.json?.code, "REMINDER_REVIEW_REQUIRED");
    assert.equal((await call("GET", `/api/reminders/${reminderId}`, tokenB)).status, 404);
  } finally {
    try {
      for (const owner of owners) {
        await pool.execute("DELETE FROM Aktivitas WHERE idPengguna = ?", [owner]);
        await pool.execute("DELETE FROM Kegiatan WHERE idPengguna = ?", [owner]);
        await pool.execute("DELETE FROM Pengguna WHERE idPengguna = ?", [owner]);
      }
    } finally {
      try { await new Promise<void>((resolve, reject) => server.close((e?: Error) => e ? reject(e) : resolve())); }
      finally { await pool.end(); }
    }
  }
});
