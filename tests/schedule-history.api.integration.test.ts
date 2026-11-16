import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import app from "../src/app.js";
import pool from "../src/config/database.js";
import { issueAccessToken } from "../src/services/auth.service.js";

type DbRow = RowDataPacket & { db: string | null };
type ApiResult = {
  success: boolean;
  message?: string;
  data?: unknown;
};

// Run only with: DB_NAME=sara_migration_test yarn tsx --test tests/schedule-history.api.integration.test.ts
// Requires migrations 0001-0009. Creates disposable verified users, deletes them in finally.
test("Schedule and History APIs enforce JWT ownership and audit activity mutations", async () => {
  const [database] = await pool.query<DbRow[]>("SELECT DATABASE() AS db");
  if (database[0]?.db !== "sara_migration_test") {
    await pool.end();
    throw new Error("Refusing to run integration test outside sara_migration_test");
  }
  const [tables] = await pool.query<RowDataPacket[]>(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'aktivitas_history' LIMIT 1",
  );
  if (!tables.length) {
    await pool.end();
    throw new Error("Apply schedule/history migrations 0006-0009 before testing");
  }
  const users: number[] = [];
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      if (server.listening) return resolve();
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const createUser = async (tag: string): Promise<number> => {
      const [result] = await pool.execute<ResultSetHeader>(
        "INSERT INTO Pengguna (nama, email, password, tanggalDaftar, emailVerifiedAt) VALUES (?, ?, ?, CURRENT_DATE(), UTC_TIMESTAMP())",
        [`Schedule ${tag}`, `schedule-${tag}-${randomUUID()}@example.test`, "test-only-hash"],
      );
      users.push(result.insertId);
      return result.insertId;
    };
    const a = await createUser("a");
    const b = await createUser("b");
    const tokenA = await issueAccessToken(a);
    const tokenB = await issueAccessToken(b);
    const call = async (method: string, path: string, token?: string, body?: unknown) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = response.status === 204 ? null : ((await response.json()) as ApiResult);
      return { status: response.status, json };
    };
    assert.equal((await call("GET", "/api/schedule")).status, 401);
    assert.equal((await call("GET", "/api/history")).status, 401);
    assert.equal((await call("GET", "/api/schedule", tokenA)).status, 422);

    const created = await call("POST", "/api/aktivitas", tokenA, {
      namaAktivitas: "Rapat proyek",
      waktuMulai: "2026-11-17T09:00:00+07:00",
      waktuSelesai: "2026-11-17T10:00:00+07:00",
      kategori: "Kuliah",
    });
    assert.equal(created.status, 201);
    const id = Number((created.json?.data as Record<string, unknown>)?.idAktivitas);
    assert.ok(Number.isSafeInteger(id) && id > 0);
    const createdB = await call("POST", "/api/aktivitas", tokenB, {
      namaAktivitas: "Private overlap",
      waktuMulai: "2026-11-17T09:15:00+07:00",
      waktuSelesai: "2026-11-17T09:45:00+07:00",
    });
    assert.equal(createdB.status, 201);

    const scheduleQuery = `?from=${encodeURIComponent("2026-11-17T00:00:00+07:00")}&to=${encodeURIComponent("2026-11-18T00:00:00+07:00")}`;
    const schedule = await call("GET", `/api/schedule${scheduleQuery}`, tokenA);
    assert.equal(schedule.status, 200);
    assert.equal((schedule.json?.data as unknown[]).length, 1);
    assert.equal(((schedule.json?.data as Record<string, unknown>[])[0]).idAktivitas, id);

    const conflictQuery = `?startAt=${encodeURIComponent("2026-11-17T09:30:00+07:00")}&endAt=${encodeURIComponent("2026-11-17T10:30:00+07:00")}`;
    const conflicts = await call("GET", `/api/schedule/conflicts${conflictQuery}`, tokenA);
    assert.equal(conflicts.status, 200);
    const c = (conflicts.json?.data as { conflicts: unknown[] }).conflicts;
    assert.equal(c.length, 1);
    assert.equal((await call("GET", `/api/schedule/conflicts${conflictQuery}`, tokenB)).status, 200);
    assert.equal((await call("GET", `/api/aktivitas/${id}/history`, tokenB)).status, 404);
    assert.equal((await call("POST", `/api/aktivitas/${id}/status`, tokenB, { status: "DONE" })).status, 404);
    assert.equal((await call("POST", `/api/aktivitas/${id}/status`, tokenA, { status: "IN PROGRESS" })).status, 200);
    assert.equal((await call("POST", `/api/aktivitas/${id}/status`, tokenA, { status: "DONE", idPengguna: b })).status, 422);

    const history = await call("GET", `/api/aktivitas/${id}/history`, tokenA);
    assert.equal(history.status, 200);
    const events = history.json?.data as Record<string, unknown>[];
    assert.deepEqual(events.map((x) => x.eventType), ["UPDATED", "CREATED"]);
    assert.equal((await call("GET", `/api/history?activityId=${id}`, tokenB)).status, 200);
    assert.equal(((await call("GET", `/api/history?activityId=${id}`, tokenB)).json?.data as unknown[]).length, 0);

    assert.equal((await call("DELETE", `/api/aktivitas/${id}`, tokenA)).status, 204);
    const deletedHistory = await call("GET", `/api/aktivitas/${id}/history`, tokenA);
    assert.equal(deletedHistory.status, 200);
    assert.deepEqual((deletedHistory.json?.data as Record<string, unknown>[]).map((x) => x.eventType), ["DELETED", "UPDATED", "CREATED"]);
  } finally {
    try {
      for (const id of users) {
        await pool.execute("DELETE FROM Aktivitas WHERE idPengguna = ?", [id]);
        await pool.execute("DELETE FROM Kegiatan WHERE idPengguna = ?", [id]);
        await pool.execute("DELETE FROM Pengguna WHERE idPengguna = ?", [id]);
      }
    } finally {
      try {
        await new Promise<void>((resolve, reject) => server.close((err?: Error) => err ? reject(err) : resolve()));
      } finally {
        await pool.end();
      }
    }
  }
});
