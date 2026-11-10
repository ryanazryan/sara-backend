
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from "../src/config/database.js";

type DatabaseRow = RowDataPacket & {
  db: string | null;
};

type ActivityRow = RowDataPacket & {
  idAktivitas: number;
  idKegiatan: number | null;
  kategori: string | null;
};

after(async () => {
  await pool.end();
});

test("SARA database schema and ownership integrity", async () => {
  const connection = await pool.getConnection();

  try {
    const [databaseRows] = await connection.query<DatabaseRow[]>(
      "SELECT DATABASE() AS db",
    );

    assert.equal(
      databaseRows[0]?.db,
      "sara_migration_test",
      "Test must only run on sara_migration_test",
    );

    await connection.beginTransaction();

    const suffix = randomUUID();

    // Membuat dua pengguna sementara
    const [userA] = await connection.execute<ResultSetHeader>(
      `INSERT INTO Pengguna
       (nama, email, password, tanggalDaftar)
       VALUES (?, ?, ?, CURRENT_DATE())`,
      ["User A", `test-a-${suffix}@example.test`, "dummy-test-hash"],
    );

    const [userB] = await connection.execute<ResultSetHeader>(
      `INSERT INTO Pengguna
       (nama, email, password, tanggalDaftar)
       VALUES (?, ?, ?, CURRENT_DATE())`,
      ["User B", `test-b-${suffix}@example.test`, "dummy-test-hash"],
    );

    // Kegiatan milik User A
    const [kegiatan] = await connection.execute<ResultSetHeader>(
      `INSERT INTO Kegiatan
       (idPengguna, namaKegiatan)
       VALUES (?, ?)`,
      [userA.insertId, "Kuliah"],
    );

    // Aktivitas User B tanpa Kegiatan dan kategori
    const [standalone] = await connection.execute<ResultSetHeader>(
      `INSERT INTO Aktivitas
       (idPengguna, idKegiatan, namaAktivitas, kategori, status)
       VALUES (?, NULL, ?, NULL, ?)`,
      [userB.insertId, "Belajar mandiri", "TO DO"],
    );

    // Aktivitas User A dengan Kegiatan dan kategori
    const [grouped] = await connection.execute<ResultSetHeader>(
      `INSERT INTO Aktivitas
       (idPengguna, idKegiatan, namaAktivitas, kategori, status)
       VALUES (?, ?, ?, ?, ?)`,
      [
        userA.insertId,
        kegiatan.insertId,
        "Mengerjakan laporan",
        "Akademik",
        "TO DO",
      ],
    );

    const [activities] = await connection.execute<ActivityRow[]>(
      `SELECT idAktivitas, idKegiatan, kategori
       FROM Aktivitas
       WHERE idAktivitas IN (?, ?)`,
      [standalone.insertId, grouped.insertId],
    );

    const standaloneRow = activities.find(
      (row) => row.idAktivitas === standalone.insertId,
    );
    const groupedRow = activities.find(
      (row) => row.idAktivitas === grouped.insertId,
    );

    assert.ok(standaloneRow);
    assert.equal(standaloneRow.idKegiatan, null);
    assert.equal(standaloneRow.kategori, null);

    assert.ok(groupedRow);
    assert.equal(groupedRow.idKegiatan, kegiatan.insertId);
    assert.equal(groupedRow.kategori, "Akademik");

    // User B tidak boleh memakai Kegiatan milik User A
    await assert.rejects(
      connection.execute(
        `INSERT INTO Aktivitas
         (idPengguna, idKegiatan, namaAktivitas, status)
         VALUES (?, ?, ?, ?)`,
        [
          userB.insertId,
          kegiatan.insertId,
          "Aktivitas lintas pengguna",
          "TO DO",
        ],
      ),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "errno" in error &&
        error.errno === 1452,
    );

    console.log("Schema and ownership validation passed");
  } finally {
    // Tidak menyimpan data pengujian secara permanen
    try {
      await connection.rollback();
    } finally {
      connection.release();
    }
  }
});
