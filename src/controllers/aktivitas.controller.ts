import type { Request, Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from "../config/database.js";
import { lockScheduleOwner, shiftActiveReminders, ScheduleConsistencyConflict, utcMs } from "../services/schedule-consistency.service.js";
import { parseAktivitas, parseId, parsePagination } from "../validators/activity.validators.js";

type AktivitasRow = RowDataPacket & {
  idAktivitas: number;
  idKegiatan: number | null;
  namaAktivitas: string;
  waktuMulai: string | null;
  waktuSelesai: string | null;
  kategori: string | null;
  prioritas: string | null;
  lokasi: string | null;
  status: string;
};

type ExistsRow = RowDataPacket & {
  found: number;
};

const columns = `
  idAktivitas,
  idKegiatan,
  namaAktivitas,
  DATE_FORMAT(waktuMulai, '%Y-%m-%dT%H:%i:%sZ') AS waktuMulai,
  DATE_FORMAT(waktuSelesai, '%Y-%m-%dT%H:%i:%sZ') AS waktuSelesai,
  kategori,
  prioritas,
  lokasi,
  status
`;

function userId(res: Response): number {
  return res.locals.authUserId as number;
}

async function getOwned(id: number, owner: number): Promise<AktivitasRow | null> {
  const [rows] = await pool.execute<AktivitasRow[]>(
    `SELECT ${columns}
     FROM Aktivitas
     WHERE idAktivitas = ?
       AND idPengguna = ?
     LIMIT 1`,
    [id, owner],
  );

  return rows[0] ?? null;
}


export async function listAktivitas(req: Request, res: Response): Promise<void> {
  const paging = parsePagination(req.query);

  if (!paging.ok) {
    res.status(422).json({
      success: false,
      message: paging.message,
    });
    return;
  }

  const { limit, offset } = paging.data;

  const [rows] = await pool.execute<AktivitasRow[]>(
    `SELECT ${columns}
     FROM Aktivitas
     WHERE idPengguna = ?
     ORDER BY idAktivitas DESC
     LIMIT ? OFFSET ?`,
    [userId(res), limit, offset],
  );

  res.json({
    success: true,
    data: rows,
    pagination: {
      limit,
      offset,
      count: rows.length,
    },
  });
}

export async function readAktivitas(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);

  if (!id) {
    res.status(422).json({
      success: false,
      message: "Invalid Aktivitas ID",
    });
    return;
  }

  const row = await getOwned(id, userId(res));

  if (!row) {
    res.status(404).json({
      success: false,
      message: "Aktivitas not found",
    });
    return;
  }

  res.json({
    success: true,
    data: row,
  });
}

export async function createAktivitas(req: Request, res: Response): Promise<void> {
  const parsed = parseAktivitas(req.body);
  if (!parsed.ok) { res.status(422).json({ success: false, message: parsed.message }); return; }
  const data = parsed.data;
  if (!data.namaAktivitas) { res.status(422).json({ success: false, message: "namaAktivitas is required" }); return; }
  const connection = await pool.getConnection();
  let insertedId: number;
  try {
    await connection.beginTransaction();
    if (!(await lockScheduleOwner(connection, userId(res)))) {
      await connection.rollback(); res.status(401).json({ success: false, message: "Invalid account" }); return;
    }
    if (data.idKegiatan !== null && data.idKegiatan !== undefined) {
      const [owned] = await connection.execute<ExistsRow[]>(
        "SELECT 1 AS found FROM Kegiatan WHERE idKegiatan = ? AND idPengguna = ? LIMIT 1", [data.idKegiatan, userId(res)]);
      if (!owned.length) {
        await connection.rollback();
        res.status(422).json({ success: false, message: "idKegiatan does not belong to current user" }); return;
      }
    }
    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT INTO Aktivitas
       (idPengguna, idKegiatan, namaAktivitas, waktuMulai, waktuSelesai,
        kategori, prioritas, lokasi, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId(res), data.idKegiatan ?? null, data.namaAktivitas, data.waktuMulai ?? null,
        data.waktuSelesai ?? null, data.kategori ?? null, data.prioritas ?? null,
        data.lokasi ?? null, data.status ?? "TO DO"],
    );
    insertedId = inserted.insertId;
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  res.status(201).json({ success: true, data: await getOwned(insertedId, userId(res)) });
}

export async function updateAktivitas(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  if (!id) { res.status(422).json({ success: false, message: "Invalid Aktivitas ID" }); return; }
  const parsed = parseAktivitas(req.body, true);
  if (!parsed.ok) { res.status(422).json({ success: false, message: parsed.message }); return; }
  const entries = Object.entries(parsed.data).filter(([, value]) => value !== undefined);
  if (!entries.length) { res.status(422).json({ success: false, message: "No valid fields provided for update" }); return; }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (!(await lockScheduleOwner(connection, userId(res)))) {
      await connection.rollback(); res.status(401).json({ success: false, message: "Invalid account" }); return;
    }
    const [rows] = await connection.execute<AktivitasRow[]>(
      `SELECT ${columns} FROM Aktivitas WHERE idAktivitas = ? AND idPengguna = ? FOR UPDATE`, [id, userId(res)]);
    const existing = rows[0];
    if (!existing) {
      await connection.rollback(); res.status(404).json({ success: false, message: "Aktivitas not found" }); return;
    }
    if (parsed.data.idKegiatan != null) {
      const [owned] = await connection.execute<ExistsRow[]>(
        "SELECT 1 AS found FROM Kegiatan WHERE idKegiatan = ? AND idPengguna = ? LIMIT 1",
        [parsed.data.idKegiatan, userId(res)]);
      if (!owned.length) {
        await connection.rollback(); res.status(422).json({ success: false, message: "idKegiatan does not belong to current user" }); return;
      }
    }
    const start = parsed.data.waktuMulai === undefined ? existing.waktuMulai : parsed.data.waktuMulai;
    const end = parsed.data.waktuSelesai === undefined ? existing.waktuSelesai : parsed.data.waktuSelesai;
    if (start && end && utcMs(end) < utcMs(start)) {
      await connection.rollback(); res.status(422).json({ success: false, message: "waktuSelesai must not be earlier than waktuMulai" }); return;
    }
    try {
      await shiftActiveReminders(connection, id, existing.waktuMulai, start);
    } catch (error) {
      if (!(error instanceof ScheduleConsistencyConflict)) throw error;
      await connection.rollback();
      res.status(409).json({ success: false, code: error.code, message: error.message }); return;
    }
    const clause = entries.map(([field]) => `\`${field}\` = ?`).join(", ");
    await connection.execute(
      `UPDATE Aktivitas SET ${clause} WHERE idAktivitas = ? AND idPengguna = ?`,
      [...entries.map(([, value]) => value), id, userId(res)]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  res.json({ success: true, data: await getOwned(id, userId(res)) });
}

export async function deleteAktivitas(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  if (!id) { res.status(422).json({ success: false, message: "Invalid Aktivitas ID" }); return; }
  const connection = await pool.getConnection();
  let affected = 0;
  try {
    await connection.beginTransaction();
    if (!(await lockScheduleOwner(connection, userId(res)))) {
      await connection.rollback(); res.status(401).json({ success: false, message: "Invalid account" }); return;
    }
    const [result] = await connection.execute<ResultSetHeader>(
      "DELETE FROM Aktivitas WHERE idAktivitas = ? AND idPengguna = ?", [id, userId(res)]);
    affected = result.affectedRows;
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  if (!affected) { res.status(404).json({ success: false, message: "Aktivitas not found" }); return; }
  res.status(204).end();
}
