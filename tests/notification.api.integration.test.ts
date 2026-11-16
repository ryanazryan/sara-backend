import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import app from "../src/app.js";
import pool from "../src/config/database.js";
import { issueAccessToken } from "../src/services/auth.service.js";
import { dispatchNotifications } from "../src/services/notification.service.js";
import { NotificationSendError, type NotificationSender } from "../src/services/notification-provider.service.js";

type DbRow = RowDataPacket & { db: string | null };
type NotificationRow = RowDataPacket & { status: string; attempts: number; total: number };
type Api = { success: boolean; data?: Record<string, unknown> | Record<string, unknown>[]; message?: string };

// Requires migrations 0001-0012. NEVER run against development or production databases.
test("Notification HTTP API and dispatcher enforce ownership, dedupe, and invalid token recovery", async () => {
  const [database] = await pool.query<DbRow[]>("SELECT DATABASE() AS db");
  if (database[0]?.db !== "sara_migration_test") { await pool.end(); throw new Error("Refusing to mutate database outside sara_migration_test"); }
  let userA: number | null = null;
  let userB: number | null = null;
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      if (server.listening) return resolve();
      server.once("listening", resolve); server.once("error", reject);
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const createUser = async (tag: string) => {
      const [row] = await pool.execute<ResultSetHeader>(
        `INSERT INTO Pengguna (nama, email, password, tanggalDaftar, emailVerifiedAt)
         VALUES (?, ?, ?, CURRENT_DATE(), UTC_TIMESTAMP())`,
        ["Notification test", `${tag}-${randomUUID()}@example.test`, "test-only-hash"]);
      return row.insertId;
    };
    userA = await createUser("a"); userB = await createUser("b");
    const tokenA = await issueAccessToken(userA);
    const tokenB = await issueAccessToken(userB);
    const call = async (method: string, path: string, token?: string, body?: unknown) => {
      const response = await fetch(`${base}${path}`, { method,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const json = response.status === 204 ? null : (await response.json()) as Api;
      return { status: response.status, json };
    };
    assert.equal((await call("GET", "/api/devices")).status, 401);
    assert.equal((await call("GET", "/api/notifications")).status, 401);
    assert.equal((await call("POST", "/api/devices", tokenA, { installationId: "install-a-123456", platform: "android", idPengguna: userB })).status, 422);

    const reg = await call("POST", "/api/devices", tokenA, {
      installationId: "install-a-123456", platform: "android", notificationPermission: "GRANTED", fcmToken: `mock-token-${randomUUID()}`,
    });
    assert.equal(reg.status, 201);
    const info = reg.json?.data as Record<string, unknown>;
    assert.ok(Number(info?.idDevice) > 0);
    assert.equal(Object.hasOwn(info, "fcmToken"), false);
    assert.equal(Object.hasOwn(info, "tokenHash"), false);
    const deviceId = Number(info.idDevice);
    assert.equal((await call("PATCH", `/api/devices/${deviceId}`, tokenB, { notificationPermission: "DENIED" })).status, 404);
    assert.equal((await call("GET", "/api/devices", tokenB)).status, 200);
    assert.equal(((await call("GET", "/api/devices", tokenB)).json?.data as object[]).length, 0);

    const [activity] = await pool.execute<ResultSetHeader>(
      "INSERT INTO Aktivitas (idPengguna, namaAktivitas, status) VALUES (?, ?, 'TO DO')", [userA, "Notification test activity"]);
    const [reminder] = await pool.execute<ResultSetHeader>(
      `INSERT INTO activity_reminders (idAktivitas, triggerAt, expiresAt, status, dueAt, createdAt, updatedAt)
       VALUES (?, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 SECOND), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'DUE', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [activity.insertId]);

    let sends = 0;
    const sender: NotificationSender = async () => { sends++; return `mock-message-${sends}`; };
    const first = await dispatchNotifications(sender);
    assert.equal(first.queued, 1);
    assert.equal(first.accepted, 1);
    assert.equal(sends, 1);
    const second = await dispatchNotifications(sender);
    assert.equal(second.queued, 0);
    assert.equal(second.accepted, 0);
    assert.equal(sends, 1);
    assert.equal((await call("GET", "/api/notifications", tokenB)).status, 200);
    assert.equal(((await call("GET", "/api/notifications", tokenB)).json?.data as object[]).length, 0);
    const notifs = await call("GET", "/api/notifications", tokenA);
    assert.equal(notifs.status, 200);
    assert.equal(((notifs.json?.data as Array<{ status: string }>)[0]).status, "ACCEPTED");

    // Retryable provider failure leaves one outbox row in RETRY without losing it.
    const [retryReminder] = await pool.execute<ResultSetHeader>(
      `INSERT INTO activity_reminders (idAktivitas, triggerAt, expiresAt, status, dueAt, createdAt, updatedAt)
       VALUES (?, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 SECOND), NULL, 'DUE', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [activity.insertId]);
    const temporaryFailure: NotificationSender = async () => {
      throw new NotificationSendError("FCM_UNAVAILABLE", true);
    };
    const retryReport = await dispatchNotifications(temporaryFailure);
    assert.equal(retryReport.retried, 1);
    const [retryRow] = await pool.execute<NotificationRow[]>(
      "SELECT status, attempts FROM notification_deliveries WHERE idReminder = ? LIMIT 1", [retryReminder.insertId]);
    assert.equal(retryRow[0]?.status, "RETRY");
    assert.equal(retryRow[0]?.attempts, 1);

    // Another reminder with an invalid FCM token must disable the device.
    const [another] = await pool.execute<ResultSetHeader>(
      `INSERT INTO activity_reminders (idAktivitas, triggerAt, expiresAt, status, dueAt, createdAt, updatedAt)
       VALUES (?, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 SECOND), NULL, 'DUE', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [activity.insertId]);
    const invalidSender: NotificationSender = async () => { throw new NotificationSendError("FCM_UNREGISTERED", false, true); };
    const third = await dispatchNotifications(invalidSender);
    assert.equal(third.failed, 1);
    const dev = await call("GET", "/api/devices", tokenA);
    assert.equal((dev.json?.data as Array<{ active: number }>)[0].active, 0);
    assert.equal((await call("DELETE", `/api/devices/${deviceId}`, tokenB)).status, 404);
    await pool.execute("DELETE FROM activity_reminders WHERE idReminder IN (?, ?, ?)", [reminder.insertId, retryReminder.insertId, another.insertId]);
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
        await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
      } finally { await pool.end(); }
    }
  }
});
