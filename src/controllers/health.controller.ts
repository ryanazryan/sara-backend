import type { Request, Response } from "express";
import pool from "../config/database.js";

export const healthCheck = (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "SARA Backend is running",
  });
};

/** Readiness is DB connectivity, not merely a running Node process. */
export const readinessCheck = async (_req: Request, res: Response): Promise<void> => {
  try {
    await pool.query({ sql: "SELECT 1", timeout: 2000 });
    res.status(200).json({ success: true, status: "ready" });
  } catch {
    // Don't leak database hostnames, SQL, credentials, or connection errors.
    res.status(503).json({ success: false, status: "not_ready" });
  }
};
