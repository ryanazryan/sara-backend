import type { Request, Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from "../config/database.js";
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

async function isOwnedKegiatan(id: number, owner: number): Promise<boolean> {
  const [rows] = await pool.execute<ExistsRow[]>(
    `SELECT 1 AS found
     FROM Kegiatan
     WHERE idKegiatan = ?
       AND idPengguna = ?
     LIMIT 1`,
    [id, owner],
  );

  return rows.length > 0;
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

  if (!parsed.ok) {
    res.status(422).json({
      success: false,
      message: parsed.message,
    });
    return;
  }

  const data = parsed.data;

  const namaAktivitas = data.namaAktivitas;
  const status = data.status ?? "TO DO";

  // Pastikan namaAktivitas bukan undefined
  if (typeof namaAktivitas !== "string" || namaAktivitas.trim().length === 0) {
    res.status(422).json({
      success: false,
      message: "namaAktivitas is required",
    });
    return;
  }

  // Pastikan Kegiatan milik pengguna saat ini
  if (data.idKegiatan != null && !(await isOwnedKegiatan(data.idKegiatan, userId(res)))) {
    res.status(422).json({
      success: false,
      message: "idKegiatan does not belong to current user",
    });
    return;
  }

  // Nilai INSERT tidak boleh mengandung undefined
  const values: (string | number | null)[] = [
    userId(res),
    data.idKegiatan ?? null,
    namaAktivitas,
    data.waktuMulai ?? null,
    data.waktuSelesai ?? null,
    data.kategori ?? null,
    data.prioritas ?? null,
    data.lokasi ?? null,
    status,
  ];

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO Aktivitas
     (
       idPengguna,
       idKegiatan,
       namaAktivitas,
       waktuMulai,
       waktuSelesai,
       kategori,
       prioritas,
       lokasi,
       status
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values,
  );

  const row = await getOwned(result.insertId, userId(res));

  res.status(201).json({
    success: true,
    data: row,
  });
}

export async function updateAktivitas(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);

  if (!id) {
    res.status(422).json({
      success: false,
      message: "Invalid Aktivitas ID",
    });
    return;
  }

  const parsed = parseAktivitas(req.body, true);

  if (!parsed.ok) {
    res.status(422).json({
      success: false,
      message: parsed.message,
    });
    return;
  }

  const existing = await getOwned(id, userId(res));

  if (!existing) {
    res.status(404).json({
      success: false,
      message: "Aktivitas not found",
    });
    return;
  }

  // Periksa kepemilikan Kegiatan jika diperbarui
  if (
    parsed.data.idKegiatan != null &&
    !(await isOwnedKegiatan(parsed.data.idKegiatan, userId(res)))
  ) {
    res.status(422).json({
      success: false,
      message: "idKegiatan does not belong to current user",
    });
    return;
  }

  const start = parsed.data.waktuMulai === undefined ? existing.waktuMulai : parsed.data.waktuMulai;

  const end =
    parsed.data.waktuSelesai === undefined ? existing.waktuSelesai : parsed.data.waktuSelesai;

  // Nilai waktu sudah dinormalisasi menjadi UTC
  const normalizeDate = (value: string): string => value.replace("T", " ").replace("Z", "");

  if (start && end && normalizeDate(end) < normalizeDate(start)) {
    res.status(422).json({
      success: false,
      message: "waktuSelesai must not be earlier than waktuMulai",
    });
    return;
  }

  // Cegah pengiriman undefined ke mysql2
  const entries = Object.entries(parsed.data).filter(([, value]) => value !== undefined);

  if (entries.length === 0) {
    res.status(422).json({
      success: false,
      message: "No valid fields provided for update",
    });
    return;
  }

  const setClause = entries.map(([field]) => `\`${field}\` = ?`).join(", ");

  const values = [...entries.map(([, value]) => value), id, userId(res)];

  await pool.execute(
    `UPDATE Aktivitas
     SET ${setClause}
     WHERE idAktivitas = ?
       AND idPengguna = ?`,
    values,
  );

  const row = await getOwned(id, userId(res));

  res.json({
    success: true,
    data: row,
  });
}

export async function deleteAktivitas(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);

  if (!id) {
    res.status(422).json({
      success: false,
      message: "Invalid Aktivitas ID",
    });
    return;
  }

  const [result] = await pool.execute<ResultSetHeader>(
    `DELETE FROM Aktivitas
     WHERE idAktivitas = ?
       AND idPengguna = ?`,
    [id, userId(res)],
  );

  if (result.affectedRows === 0) {
    res.status(404).json({
      success: false,
      message: "Aktivitas not found",
    });
    return;
  }

  res.status(204).end();
}
