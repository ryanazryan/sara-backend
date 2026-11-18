import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import app from "../src/app.js";
import pool from "../src/config/database.js";
import { issueAccessToken } from "../src/services/auth.service.js";

type Db = RowDataPacket & { db: string | null };
type TimeRow = RowDataPacket & { at: string; endsAt?: string | null };
type CountRow = RowDataPacket & { n: number };
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 19) + "Z";
const sqlTime = (ms: number): string => iso(ms).replace("T", " ").replace("Z", "");

test("invalid reminder shift rolls back activity, reminders and audit history; ownership is isolated", async () => {
  const [database] = await pool.query<Db[]>("SELECT DATABASE() AS db");
  if (database[0]?.db !== "sara_migration_test") {
    await pool.end();
    throw Error("REFUSING writes outside sara_migration_test");
  }
  const owners: number[] = [];
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      if (server.listening) return resolve();
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const makeUser = async () => {
      const [row] = await pool.execute<ResultSetHeader>(
        "INSERT INTO Pengguna (nama,email,password,tanggalDaftar,emailVerifiedAt) VALUES (?, ?, ?, CURRENT_DATE(), UTC_TIMESTAMP())",
        ["QA Rollback", `${randomUUID()}@example.test`, "test-only-hash"],
      );
      owners.push(row.insertId);
      return row.insertId;
    };
    const userA = await makeUser();
    const userB = await makeUser();
    const jwtA = await issueAccessToken(userA);
    const jwtB = await issueAccessToken(userB);
    const now = Math.ceil(Date.now() / 60_000) * 60_000;
    const start = now + 48 * 3_600_000;
    const end = start + 3_600_000;
    const reminder = now + 24 * 3_600_000;
    const expires = reminder + 3_600_000;
    const [activity] = await pool.execute<ResultSetHeader>(
      "INSERT INTO Aktivitas (idPengguna,namaAktivitas,waktuMulai,waktuSelesai,status) VALUES (?,?,?,?, 'TO DO')",
      [userA, "QA rollback target", sqlTime(start), sqlTime(end)],
    );
    const [reminderRow] = await pool.execute<ResultSetHeader>(
      "INSERT INTO activity_reminders (idAktivitas,triggerAt,expiresAt,status,createdAt,updatedAt) VALUES (?,?,?,'PENDING',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",
      [activity.insertId, sqlTime(reminder), sqlTime(expires)],
    );
    const read = async (table: "Aktivitas" | "activity_reminders", id: number) => {
      if (table === "Aktivitas") {
        const [rows] = await pool.execute<TimeRow[]>(
          "SELECT DATE_FORMAT(waktuMulai,'%Y-%m-%dT%H:%i:%sZ') AS at, DATE_FORMAT(waktuSelesai,'%Y-%m-%dT%H:%i:%sZ') AS endsAt FROM Aktivitas WHERE idAktivitas=?",
          [id],
        );
        return rows[0];
      }
      const [rows] = await pool.execute<TimeRow[]>(
        "SELECT DATE_FORMAT(triggerAt,'%Y-%m-%dT%H:%i:%sZ') AS at, DATE_FORMAT(expiresAt,'%Y-%m-%dT%H:%i:%sZ') AS endsAt FROM activity_reminders WHERE idReminder=?",
        [id],
      );
      return rows[0];
    };
    const initialActivity = await read("Aktivitas", activity.insertId);
    const initialReminder = await read("activity_reminders", reminderRow.insertId);
    const patch = async (token: string, startMs: number, endMs: number) => {
      const response = await fetch(`${base}/api/aktivitas/${activity.insertId}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ waktuMulai: iso(startMs), waktuSelesai: iso(endMs) }),
      });
      return { status: response.status, body: (await response.json()) as { code?: string } };
    };
    // User B may not mutate user A's activity, even with a well-formed JWT.
    assert.equal((await patch(jwtB, start + 3_600_000, end + 3_600_000)).status, 404);
    // Activity remains in the future but its existing reminder would move into
    // the past. The transaction must reject the entire operation.
    const rejected = await patch(jwtA, now + 12 * 3_600_000, now + 13 * 3_600_000);
    assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    assert.equal(rejected.body.code, "REMINDER_SHIFT_PAST");
    assert.deepEqual(await read("Aktivitas", activity.insertId), initialActivity);
    assert.deepEqual(await read("activity_reminders", reminderRow.insertId), initialReminder);
    const [history] = await pool.execute<CountRow[]>(
      "SELECT COUNT(*) AS n FROM aktivitas_history WHERE idAktivitas=? AND eventType='UPDATED'",
      [activity.insertId],
    );
    assert.equal(history[0].n, 0, "failed updates must not emit UPDATE history");
  } finally {
    try {
      for (const id of owners) {
        await pool.execute("DELETE FROM Aktivitas WHERE idPengguna=?", [id]);
        await pool.execute("DELETE FROM Kegiatan WHERE idPengguna=?", [id]);
        await pool.execute("DELETE FROM Pengguna WHERE idPengguna=?", [id]);
      }
    } finally {
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((err?: Error) => err ? reject(err) : resolve());
        });
      } finally { await pool.end(); }
    }
  }
});
