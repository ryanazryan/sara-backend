import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import app from "../src/app.js";
import pool from "../src/config/database.js";
import { issueAccessToken } from "../src/services/auth.service.js";

type DbRow = RowDataPacket & { db: string | null };
type JsonResult = {
  success: boolean;
  data?: Record<string, unknown> | Array<Record<string, unknown>>;
  message?: string;
};

// This integration test creates two temporary users on the dedicated test DB,
// calls real Express routes, and cleans everything up in a finally block.
test("Kegiatan/Aktivitas HTTP API enforces ownership and nullable grouping", async () => {
  const [database] = await pool.query<DbRow[]>("SELECT DATABASE() AS db");
  if (database[0]?.db !== "sara_migration_test") {
    await pool.end();
    throw new Error("Refusing to write outside sara_migration_test");
  }

  let userA: number | null = null;
  let userB: number | null = null;
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      if (server.listening) {
        resolve();
        return;
      }
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    const createUser = async (tag: string): Promise<number> => {
      const [r] = await pool.execute<ResultSetHeader>(
        "INSERT INTO Pengguna (nama,email,password,tanggalDaftar,emailVerifiedAt) VALUES (?, ?, ?, CURRENT_DATE(), UTC_TIMESTAMP())",
        [`Smoke ${tag}`, `${tag}-${randomUUID()}@example.test`, "test-only-dummy-hash"],
      );
      return r.insertId;
    };
    userA = await createUser("a");
    userB = await createUser("b");
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
      const data = response.status === 204 ? null : ((await response.json()) as JsonResult);
      return { status: response.status, data };
    };
    assert.equal((await call("GET", "/api/kegiatan")).status, 401);

    const created = await call("POST", "/api/kegiatan", tokenA, {
      namaKegiatan: "Kuliah",
      estimasiDurasi: 90,
    });
    assert.equal(created.status, 201);
    const kegiatanId = Number((created.data?.data as Record<string, unknown>)?.idKegiatan);
    assert.ok(Number.isSafeInteger(kegiatanId) && kegiatanId > 0);
    assert.equal((await call("GET", `/api/kegiatan/${kegiatanId}`, tokenB)).status, 404);
    assert.equal((await call("GET", "/api/kegiatan?limit=10&offset=0", tokenA)).status, 200);
    assert.equal(
      (
        await call("PATCH", `/api/kegiatan/${kegiatanId}`, tokenA, {
          deskripsi: "Semester berjalan",
          estimasiDurasi: 120,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("POST", "/api/kegiatan", tokenA, {
          namaKegiatan: "Do not trust client owner",
          idPengguna: userB,
        })
      ).status,
      422,
    );

    const forbiddenLink = await call("POST", "/api/aktivitas", tokenB, {
      namaAktivitas: "Cross owner",
      idKegiatan: kegiatanId,
    });
    assert.equal(forbiddenLink.status, 422);

    const standalone = await call("POST", "/api/aktivitas", tokenB, {
      namaAktivitas: "Belajar mandiri",
      kategori: null,
    });
    assert.equal(standalone.status, 201);
    assert.equal((standalone.data?.data as Record<string, unknown>)?.idKegiatan, null);
    const standaloneId = Number((standalone.data?.data as Record<string, unknown>)?.idAktivitas);

    const grouped = await call("POST", "/api/aktivitas", tokenA, {
      namaAktivitas: "Kerjakan laporan",
      idKegiatan: kegiatanId,
      kategori: "Akademik",
    });
    assert.equal(grouped.status, 201);
    const activityId = Number((grouped.data?.data as Record<string, unknown>)?.idAktivitas);

    assert.equal((await call("DELETE", `/api/kegiatan/${kegiatanId}`, tokenA)).status, 409);
    assert.equal((await call("GET", "/api/aktivitas?limit=10&offset=0", tokenA)).status, 200);
    assert.equal(
      (await call("PATCH", `/api/aktivitas/${activityId}`, tokenB, { status: "Selesai" })).status,
      404,
    );
    assert.equal(
      (await call("PATCH", `/api/aktivitas/${activityId}`, tokenA, { idKegiatan: null })).status,
      200,
    );
    assert.equal((await call("DELETE", `/api/kegiatan/${kegiatanId}`, tokenA)).status, 204);
    assert.equal((await call("DELETE", `/api/aktivitas/${standaloneId}`, tokenA)).status, 404);
    assert.equal((await call("DELETE", `/api/aktivitas/${standaloneId}`, tokenB)).status, 204);
  } finally {
    // Cleanup is explicit because HTTP handlers use multiple pool connections.
    try {
      for (const id of [userA, userB]) {
        if (id !== null) {
          await pool.execute("DELETE FROM Aktivitas WHERE idPengguna = ?", [id]);
          await pool.execute("DELETE FROM Kegiatan WHERE idPengguna = ?", [id]);
          await pool.execute("DELETE FROM Pengguna WHERE idPengguna = ?", [id]);
        }
      }
    } finally {
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error?: Error) => (error ? reject(error) : resolve()));
        });
      } finally {
        await pool.end();
      }
    }
  }
});
