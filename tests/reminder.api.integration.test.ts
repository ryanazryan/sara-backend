import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import app from "../src/app.js";
import pool from "../src/config/database.js";
import { issueAccessToken } from "../src/services/auth.service.js";
import { processDueReminders } from "../src/services/reminder.service.js";

type DbRow = RowDataPacket & { db: string | null };
type CountRow = RowDataPacket & { total: number };
type Result = { success: boolean; data?: Record<string, unknown> | Record<string, unknown>[]; message?: string };
const iso = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString().slice(0, 19) + "Z";

test("Reminder CRUD respects JWT ownership and worker promotes a reminder once", async () => {
  const [db] = await pool.query<DbRow[]>("SELECT DATABASE() AS db");
  if (db[0]?.db !== "sara_migration_test") {
    await pool.end();
    throw new Error("Refusing to mutate any database other than sara_migration_test");
  }
  let userA: number | null = null;
  let userB: number | null = null;
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      if (server.listening) return resolve();
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const makeUser = async (tag: string) => {
      const [result] = await pool.execute<ResultSetHeader>(
        `INSERT INTO Pengguna (nama, email, password, tanggalDaftar, emailVerifiedAt)
         VALUES (?, ?, ?, CURRENT_DATE(), UTC_TIMESTAMP())`,
        ["Reminder Test", `${tag}-${randomUUID()}@example.test`, "test-hash"],
      );
      return result.insertId;
    };
    userA = await makeUser("a");
    userB = await makeUser("b");
    const [activity] = await pool.execute<ResultSetHeader>(
      `INSERT INTO Aktivitas (idPengguna, namaAktivitas, status) VALUES (?, ?, 'TO DO')`,
      [userA, "Reminder test activity"],
    );
    const activityId = activity.insertId;
    const tokenA = await issueAccessToken(userA);
    const tokenB = await issueAccessToken(userB);
    const call = async (method: string, path: string, token?: string, body?: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json: Result | null = response.status === 204 ? null : await response.json() as Result;
      return { status: response.status, json };
    };
    assert.equal((await call("GET", "/api/reminders")).status, 401);
    assert.equal((await call("POST", `/api/aktivitas/${activityId}/reminders`, tokenB, { triggerAt: iso(3600000) })).status, 404);
    assert.equal((await call("POST", `/api/aktivitas/${activityId}/reminders`, tokenA, { triggerAt: iso(-3600000) })).status, 422);

    const created = await call("POST", `/api/aktivitas/${activityId}/reminders`, tokenA, {
      triggerAt: iso(3600000), expiresAt: iso(7200000),
    });
    assert.equal(created.status, 201);
    const reminderId = Number((created.json?.data as Record<string, unknown>)?.idReminder);
    assert.ok(reminderId > 0);
    assert.equal((created.json?.data as Record<string, unknown>)?.status, "PENDING");
    assert.equal((await call("GET", `/api/reminders/${reminderId}`, tokenB)).status, 404);
    assert.equal((await call("PATCH", `/api/reminders/${reminderId}`, tokenB, { triggerAt: iso(4500000) })).status, 404);
    assert.equal((await call("GET", `/api/aktivitas/${activityId}/reminders`, tokenA)).status, 200);
    assert.equal((await call("GET", "/api/reminders?status=PENDING", tokenA)).status, 200);

    const updated = await call("PATCH", `/api/reminders/${reminderId}`, tokenA, { triggerAt: iso(5400000), expiresAt: null });
    assert.equal(updated.status, 200);
    assert.equal((updated.json?.data as Record<string, unknown>)?.revision, 2);
    // Simulate time passing by adjusting only this test reminder in the isolated DB.
    await pool.execute(
      `UPDATE activity_reminders SET triggerAt = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND)
       WHERE idReminder = ?`, [reminderId],
    );
    const first = await processDueReminders();
    const second = await processDueReminders();
    assert.equal(first.due, 1);
    assert.equal(second.due, 0);
    const due = await call("GET", `/api/reminders/${reminderId}`, tokenA);
    assert.equal((due.json?.data as Record<string, unknown>)?.status, "DUE");
    assert.equal((await call("PATCH", `/api/reminders/${reminderId}`, tokenA, { triggerAt: iso(3600000) })).status, 409);
    assert.equal((await call("DELETE", `/api/reminders/${reminderId}`, tokenB)).status, 404);
    assert.equal((await call("DELETE", `/api/reminders/${reminderId}`, tokenA)).status, 204);
    assert.equal((await call("DELETE", `/api/reminders/${reminderId}`, tokenA)).status, 204);
    assert.equal((await call("GET", `/api/reminders/${reminderId}`, tokenA)).status, 200);

    const another = await call("POST", `/api/aktivitas/${activityId}/reminders`, tokenA, { triggerAt: iso(7200000) });
    assert.equal(another.status, 201);
    const anotherId = Number((another.json?.data as Record<string, unknown>)?.idReminder);
    assert.equal((await call("DELETE", `/api/aktivitas/${activityId}`, tokenA)).status, 204);
    const [remaining] = await pool.execute<CountRow[]>(
      "SELECT COUNT(*) AS total FROM activity_reminders WHERE idReminder = ?", [anotherId],
    );
    assert.equal(remaining[0]?.total, 0);
  } finally {
    try {
      for (const id of [userA, userB]) {
        if (id === null) continue;
        await pool.execute("DELETE FROM Aktivitas WHERE idPengguna = ?", [id]);
        await pool.execute("DELETE FROM Kegiatan WHERE idPengguna = ?", [id]);
        await pool.execute("DELETE FROM Pengguna WHERE idPengguna = ?", [id]);
      }
    } finally {
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error?: Error) => error ? reject(error) : resolve());
        });
      } finally {
        await pool.end();
      }
    }
  }
});
