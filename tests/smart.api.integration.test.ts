import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import app from "../src/app.js";
import pool from "../src/config/database.js";
import { issueAccessToken } from "../src/services/auth.service.js";

type DbRow = RowDataPacket & { db: string | null };
type ActivityDb = RowDataPacket & { waktuMulai: string | null; waktuSelesai: string | null };
type HistoryCount = RowDataPacket & { count: number };
type ApiResponse = { success: boolean; code?: string; replayed?: boolean; data?: Record<string, unknown>; message?: string };
const iso = (millis: number) => new Date(millis).toISOString().slice(0, 19) + "Z";

test("Smart Assistance suggests owned slots and confirms safely without duplicate scheduling", async () => {
  const [db] = await pool.query<DbRow[]>("SELECT DATABASE() AS db");
  if (db[0]?.db !== "sara_migration_test") {
    await pool.end();
    throw new Error("Refusing to write outside sara_migration_test");
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
    const createUser = async (): Promise<number> => {
      const [r] = await pool.execute<ResultSetHeader>(
        "INSERT INTO Pengguna (nama,email,password,tanggalDaftar,emailVerifiedAt) VALUES (?, ?, ?, CURRENT_DATE(), UTC_TIMESTAMP())",
        ["Smart Test", `${randomUUID()}@example.test`, "test-only-hash"],
      );
      users.push(r.insertId);
      return r.insertId;
    };
    const a = await createUser();
    const b = await createUser();
    const jwtA = await issueAccessToken(a);
    const jwtB = await issueAccessToken(b);
    const call = async (method: string, path: string, token?: string, body?: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, json: (await response.json()) as ApiResponse };
    };
    const fromMs = Math.ceil((Date.now() + 24 * 3600000) / 3600000) * 3600000;
    const makeActivity = async (idPengguna: number, name: string, startMs: number, endMs: number, prioritas?: string) => {
      const [r] = await pool.execute<ResultSetHeader>(
        "INSERT INTO Aktivitas (idPengguna,namaAktivitas,waktuMulai,waktuSelesai,status,prioritas) VALUES (?,?,?,?, 'TO DO', ?)",
        [idPengguna, name, iso(startMs).replace("T", " ").replace("Z", ""),
          iso(endMs).replace("T", " ").replace("Z", ""), prioritas ?? null],
      );
      return r.insertId;
    };
    const target = await makeActivity(a, "Target for suggestion", fromMs - 5 * 3600000, fromMs - 4 * 3600000, "Tinggi");
    const occupied = await makeActivity(a, "Busy schedule", fromMs, fromMs + 3600000, "Rendah");
    await makeActivity(b, "Other owner schedule", fromMs + 3600000, fromMs + 2 * 3600000);
    assert.equal((await call("POST", "/api/assistant/suggestions", undefined, {})).status, 401);
    const request = { activityId: target, windowStart: iso(fromMs), windowEnd: iso(fromMs + 4 * 3600000),
      durationMinutes: 60, maxSuggestions: 3 };
    assert.equal((await call("POST", "/api/assistant/suggestions", jwtB, request)).status, 404);
    const create = await call("POST", "/api/assistant/suggestions", jwtA, request);
    assert.equal(create.status, 201, JSON.stringify(create.json));
    assert.equal(create.json.data?.state, "READY");
    const analysisId = String(create.json.data?.id);
    const slots = create.json.data?.availableSlots as { startAt: string; endAt: string }[];
    assert.equal(slots[0]?.startAt, iso(fromMs + 3600000));
    const conflicts = create.json.data?.conflicts as Array<{ idAktivitas: number }>;
    assert.ok(conflicts.some((item) => item.idAktivitas === occupied));
    assert.equal((await call("GET", `/api/assistant/suggestions/${analysisId}`, jwtB)).status, 404);
    assert.equal((await call("POST", `/api/assistant/suggestions/${analysisId}/confirm`, jwtB, { slotIndex: 0 })).status, 404);
    const applied = await call("POST", `/api/assistant/suggestions/${analysisId}/confirm`, jwtA, { slotIndex: 0 });
    assert.equal(applied.status, 200, JSON.stringify(applied.json));
    assert.equal(applied.json.replayed, false);
    assert.equal((await call("POST", `/api/assistant/suggestions/${analysisId}/confirm`, jwtA, { slotIndex: 0 })).json.replayed, true);
    assert.equal((await call("POST", `/api/assistant/suggestions/${analysisId}/confirm`, jwtA, { slotIndex: 1 })).status, 409);
    const [targetRows] = await pool.execute<ActivityDb[]>(
      "SELECT DATE_FORMAT(waktuMulai, '%Y-%m-%dT%H:%i:%sZ') AS waktuMulai, DATE_FORMAT(waktuSelesai, '%Y-%m-%dT%H:%i:%sZ') AS waktuSelesai FROM Aktivitas WHERE idAktivitas = ?",
      [target],
    );
    assert.equal(targetRows[0]?.waktuMulai, slots[0]?.startAt);
    assert.equal(targetRows[0]?.waktuSelesai, slots[0]?.endAt);
    const [history] = await pool.execute<HistoryCount[]>(
      "SELECT COUNT(*) AS count FROM aktivitas_history WHERE idAktivitas = ? AND eventType = 'UPDATED'", [target],
    );
    assert.equal(history[0]?.count, 1);
    const priority = await call("GET", "/api/assistant/priorities?limit=10&offset=0", jwtA);
    assert.equal(priority.status, 200);
    const priorityRows = priority.json.data as unknown as Array<{ idAktivitas: number }>;
    assert.equal(priorityRows[0]?.idAktivitas, target);

    // Re-check occupied time at confirmation: later changes invalidate the preview.
    const target2 = await makeActivity(a, "Target with conflict", fromMs - 6 * 3600000, fromMs - 5 * 3600000);
    const request2 = await call("POST", "/api/assistant/suggestions", jwtA, { ...request, activityId: target2 });
    assert.equal(request2.status, 201);
    const slot2 = (request2.json.data?.availableSlots as { startAt: string; endAt: string }[])[0];
    await makeActivity(a, "New conflicting meeting", Date.parse(slot2.startAt), Date.parse(slot2.endAt));
    const conflict = await call("POST", `/api/assistant/suggestions/${request2.json.data?.id}/confirm`, jwtA, { slotIndex: 0 });
    assert.equal(conflict.status, 409, JSON.stringify(conflict.json));
    assert.equal(conflict.json.code, "SLOT_CONFLICT");

    // Active reminder cannot be silently left behind after moving the schedule.
    const target3 = await makeActivity(a, "Target with active reminder", fromMs - 7 * 3600000, fromMs - 6 * 3600000);
    await pool.execute(
      "INSERT INTO activity_reminders (idAktivitas,triggerAt,expiresAt,status,createdAt,updatedAt) VALUES (?, ?, NULL, 'PENDING', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
      [target3, iso(fromMs + 8 * 3600000).replace("T", " ").replace("Z", "")],
    );
    const request3 = await call("POST", "/api/assistant/suggestions", jwtA, { ...request, activityId: target3 });
    assert.equal(request3.status, 201);
    assert.equal(request3.json.data?.requiresReminderReview, true);
    const shifted = await call("POST", `/api/assistant/suggestions/${request3.json.data?.id}/confirm`, jwtA, { slotIndex: 0 });
    assert.equal(shifted.status, 200, JSON.stringify(shifted.json));
    assert.equal(shifted.json.data?.remindersUpdated, true);
    assert.equal(shifted.json.data?.shiftedReminders, 1);
    const [pending] = await pool.execute<(RowDataPacket & { revision: number; triggerAt: string })[]>(
      `SELECT revision, DATE_FORMAT(triggerAt, '%Y-%m-%dT%H:%i:%sZ') AS triggerAt
       FROM activity_reminders WHERE idAktivitas = ? LIMIT 1`, [target3]);
    assert.equal(pending[0]?.revision, 2);
    const newStart = Date.parse((shifted.json.data?.startAt as string));
    const oldStart = fromMs - 7 * 3600000;
    assert.equal(Date.parse(pending[0].triggerAt), fromMs + 8 * 3600000 + (newStart - oldStart));
  } finally {
    try {
      for (const id of users) {
        // FK delete cascades suggestions, reminders, notifications and history.
        await pool.execute("DELETE FROM Aktivitas WHERE idPengguna = ?", [id]);
        await pool.execute("DELETE FROM Kegiatan WHERE idPengguna = ?", [id]);
        await pool.execute("DELETE FROM Pengguna WHERE idPengguna = ?", [id]);
      }
    } finally {
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error?: Error) => error ? reject(error) : resolve());
        });
      } finally { await pool.end(); }
    }
  }
});
