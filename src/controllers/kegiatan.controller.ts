import type { Request, Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from "../config/database.js";
import { parseId, parseKegiatan, parsePagination } from "../validators/activity.validators.js";

type KegiatanRow = RowDataPacket & {
  idKegiatan: number;
  namaKegiatan: string;
  deskripsi: string | null;
  estimasiDurasi: number | null;
};

type ExistsRow = RowDataPacket & { found: number };

function userId(res: Response): number {
  return res.locals.authUserId as number;
}

async function getOwned(id: number, owner: number): Promise<KegiatanRow | null> {
  const [rows] = await pool.execute<KegiatanRow[]>(
    `SELECT idKegiatan, namaKegiatan, deskripsi, estimasiDurasi
     FROM Kegiatan WHERE idKegiatan = ? AND idPengguna = ? LIMIT 1`,
    [id, owner],
  );
  return rows[0] ?? null;
}

export async function listKegiatan(req: Request, res: Response): Promise<void> {
  const paging = parsePagination(req.query);
  if (!paging.ok) {
    res.status(422).json({ success: false, message: paging.message });
    return;
  }
  const { limit, offset } = paging.data;
  const [rows] = await pool.execute<KegiatanRow[]>(
    `SELECT idKegiatan, namaKegiatan, deskripsi, estimasiDurasi
     FROM Kegiatan WHERE idPengguna = ? ORDER BY idKegiatan DESC LIMIT ? OFFSET ?`,
    [userId(res), limit, offset],
  );
  res.json({ success: true, data: rows, pagination: { limit, offset, count: rows.length } });
}

export async function readKegiatan(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(422).json({ success: false, message: "Invalid Kegiatan ID" });
    return;
  }
  const row = await getOwned(id, userId(res));
  if (!row) {
    res.status(404).json({ success: false, message: "Kegiatan not found" });
    return;
  }
  res.json({ success: true, data: row });
}

export async function createKegiatan(req: Request, res: Response): Promise<void> {
  const parsed = parseKegiatan(req.body);
  if (!parsed.ok) {
    res.status(422).json({ success: false, message: parsed.message });
    return;
  }
  const { namaKegiatan, deskripsi = null, estimasiDurasi = null } = parsed.data;
  if (namaKegiatan === undefined) {
  res.status(422).json({
    success: false,
    message: "namaKegiatan is required",
  });
  return;
}
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO Kegiatan (idPengguna, namaKegiatan, deskripsi, estimasiDurasi)
     VALUES (?, ?, ?, ?)`,
    [userId(res), namaKegiatan, deskripsi, estimasiDurasi],
  );
  const row = await getOwned(result.insertId, userId(res));
  res.status(201).json({ success: true, data: row });
}

export async function updateKegiatan(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(422).json({ success: false, message: "Invalid Kegiatan ID" });
    return;
  }
  const parsed = parseKegiatan(req.body, true);
  if (!parsed.ok) {
    res.status(422).json({ success: false, message: parsed.message });
    return;
  }
  if (!(await getOwned(id, userId(res)))) {
    res.status(404).json({ success: false, message: "Kegiatan not found" });
    return;
  }
  const entries = Object.entries(parsed.data);
  await pool.execute(
    `UPDATE Kegiatan SET ${entries.map(([field]) => `\`${field}\` = ?`).join(", ")}
     WHERE idKegiatan = ? AND idPengguna = ?`,
    [...entries.map(([, value]) => value), id, userId(res)],
  );
  const row = await getOwned(id, userId(res));
  res.json({ success: true, data: row });
}

export async function deleteKegiatan(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(422).json({ success: false, message: "Invalid Kegiatan ID" });
    return;
  }
  if (!(await getOwned(id, userId(res)))) {
    res.status(404).json({ success: false, message: "Kegiatan not found" });
    return;
  }
  const [linked] = await pool.execute<ExistsRow[]>(
    "SELECT 1 AS found FROM Aktivitas WHERE idKegiatan = ? AND idPengguna = ? LIMIT 1",
    [id, userId(res)],
  );
  if (linked.length) {
    res
      .status(409)
      .json({
        success: false,
        message: "Detach or delete related Aktivitas before deleting Kegiatan",
      });
    return;
  }
  try {
    await pool.execute("DELETE FROM Kegiatan WHERE idKegiatan = ? AND idPengguna = ?", [
      id,
      userId(res),
    ]);
    res.status(204).end();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "ER_ROW_IS_REFERENCED_2" || error.code === "ER_ROW_IS_REFERENCED")
    ) {
      res.status(409).json({ success: false, message: "Kegiatan still has related Aktivitas" });
      return;
    }
    throw error;
  }
}
