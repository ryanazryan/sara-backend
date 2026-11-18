import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import app from "../src/app.js";
import pool from "../src/config/database.js";
import { issueAccessToken } from "../src/services/auth.service.js";

type DbRow = RowDataPacket & { db: string | null };
type CountRow = RowDataPacket & { total: number };
type JsonResponse = { success: boolean; replayed?: boolean; data?: Record<string, unknown>; code?: string };
const isoFuture = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString().slice(0, 19) + "Z";

test("NLP preview/confirm is transactional, owned and safe to repeat", async () => {
  const [db] = await pool.query<DbRow[]>("SELECT DATABASE() AS db");
  if (db[0]?.db !== "sara_migration_test") {
    await pool.end();
    throw new Error("Refusing to write outside sara_migration_test");
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
    const createUser = async (tag: string) => {
      const [r] = await pool.execute<ResultSetHeader>(
        "INSERT INTO Pengguna (nama,email,password,tanggalDaftar,emailVerifiedAt) VALUES (?, ?, ?, CURRENT_DATE(), UTC_TIMESTAMP())",
        ["NLP tester", `${tag}-${randomUUID()}@example.test`, "test-dummy-hash"],
      );
      return r.insertId;
    };
    userA = await createUser("a");
    userB = await createUser("b");
    const tokenA = await issueAccessToken(userA);
    const tokenB = await issueAccessToken(userB);
    const call = async (method: string, path: string, token?: string, body?: unknown) => {
      const response = await fetch(base + path, { method,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = response.status === 204 ? null : await response.json() as JsonResponse;
      return { status: response.status, json };
    };
    assert.equal((await call("POST", "/api/ai/parse", undefined, {})).status, 401);
    assert.equal((await call("POST", "/api/ai/parse", tokenA, { text: "Hapus semua jadwal", timeZone: "Asia/Makassar" })).status, 422);
    const unclear = await call("POST", "/api/ai/parse", tokenA, { text: "Ingatkan saya kuliah besok jam 8", timeZone: "Asia/Makassar" });
    assert.equal(unclear.status, 200);
    assert.equal(unclear.json?.data?.state, "NEEDS_CLARIFICATION");
    const unclearId = String(unclear.json?.data?.id);
    assert.equal((await call("POST", `/api/ai/interpretations/${unclearId}/confirm`, tokenA, {})).status, 409);

    const draft = await call("POST", "/api/ai/parse", tokenA, {
      text: "Ingatkan saya mengerjakan laporan besok jam 8 malam", timeZone: "Asia/Makassar", locale: "id-ID",
    });
    assert.equal(draft.status, 200);
    assert.equal(draft.json?.data?.state, "READY");
    const id = String(draft.json?.data?.id);
    assert.equal((await call("GET", `/api/ai/interpretations/${id}`, tokenB)).status, 404);
    assert.equal((await call("POST", `/api/ai/interpretations/${id}/confirm`, tokenB, {})).status, 404);
    assert.equal((await call("POST", `/api/ai/interpretations/${id}/confirm`, tokenA, { idPengguna: userB })).status, 422);
    assert.equal((await call("GET", `/api/ai/interpretations/${id}`, tokenA)).status, 200);

    const [first, second] = await Promise.all([
      call("POST", `/api/ai/interpretations/${id}/confirm`, tokenA, {}),
      call("POST", `/api/ai/interpretations/${id}/confirm`, tokenA, {}),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 201]);
    const created = first.status === 201 ? first : second;
    const activity = created.json?.data?.activity as Record<string, unknown>;
    const reminder = created.json?.data?.reminder as Record<string, unknown>;
    const activityId = Number(activity?.idAktivitas);
    const reminderId = Number(reminder?.idReminder);
    assert.ok(activityId > 0 && reminderId > 0);
    assert.equal((await call("POST", `/api/ai/interpretations/${id}/confirm`, tokenA, {
      overrides: { namaAktivitas: "Different" },
    })).status, 409);
    const [activityCount] = await pool.execute<CountRow[]>(
      "SELECT COUNT(*) AS total FROM Aktivitas WHERE idAktivitas = ? AND idPengguna = ?", [activityId, userA],
    );
    assert.equal(activityCount[0]?.total, 1);
    const [reminderCount] = await pool.execute<CountRow[]>(
      "SELECT COUNT(*) AS total FROM activity_reminders WHERE idAktivitas = ?", [activityId],
    );
    assert.equal(reminderCount[0]?.total, 1);
    const [audit] = await pool.execute<CountRow[]>(
      "SELECT COUNT(*) AS total FROM aktivitas_history WHERE idAktivitas = ? AND eventType = 'CREATED'", [activityId],
    );
    assert.equal(audit[0]?.total, 1);

    const editDraft = await call("POST", "/api/ai/parse", tokenA, {
      text: "Buat aktivitas olahraga", timeZone: "Asia/Jakarta",
    });
    assert.equal(editDraft.status, 200, "Buat aktivitas harus diterima oleh NLP parse");
    assert.equal(editDraft.json?.data?.state, "READY");
    const editId = String(editDraft.json?.data?.id);
    const edited = await call("POST", `/api/ai/interpretations/${editId}/confirm`, tokenA, {
      overrides: { namaAktivitas: "Olahraga pagi", waktuMulai: isoFuture(48) },
    });
    assert.equal(edited.status, 201);
    assert.equal((edited.json?.data?.activity as Record<string, unknown>).namaAktivitas, "Olahraga pagi");
    const [editedReminder] = await pool.execute<CountRow[]>(
      "SELECT COUNT(*) AS total FROM activity_reminders WHERE idAktivitas = ?",
      [Number((edited.json?.data?.activity as Record<string, unknown>).idAktivitas)],
    );
    assert.equal(editedReminder[0]?.total, 0);
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
      } finally {
        await pool.end();
      }
    }
  }
});
