import type { Request, Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from "../config/database.js";
import {
  createOtp,
  hashPassword,
  issueAccessToken,
  otpDigest,
  otpMatches,
  verifyPassword,
} from "../services/auth.service.js";
import { sendVerificationCode } from "../services/email.service.js";
import {
  parseEmailOnly,
  parseLogin,
  parseRegister,
  parseVerification,
} from "../validators/auth.validators.js";

type UserRow = RowDataPacket & {
  idPengguna: number;
  nama: string;
  email: string;
  password: string;
  emailVerifiedAt: Date | null;
};

type OtpRow = RowDataPacket & {
  codeHash: string;
  attempts: number;
  isValid: number;
};

type ExistsRow = RowDataPacket & { existsRecently: number };

async function findUser(email: string): Promise<UserRow | null> {
  const [rows] = await pool.execute<UserRow[]>(
    "SELECT idPengguna, nama, email, password, emailVerifiedAt FROM Pengguna WHERE email = ? LIMIT 1",
    [email],
  );
  return rows[0] ?? null;
}

async function createAndEmailOtp(idPengguna: number, email: string): Promise<void> {
  const code = createOtp();
  await pool.execute(
    `INSERT INTO email_verification_codes
     (idPengguna, codeHash, expiresAt, attempts, createdAt)
     VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE), 0, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       codeHash = VALUES(codeHash),
       expiresAt = VALUES(expiresAt),
       attempts = 0,
       createdAt = UTC_TIMESTAMP()`,
    [idPengguna, otpDigest(idPengguna, code)],
  );
  await sendVerificationCode(email, code);
}

export async function register(req: Request, res: Response): Promise<void> {
  const parsed = parseRegister(req.body);
  if (!parsed.ok) {
    res.status(422).json({ success: false, message: parsed.message });
    return;
  }
  const { fullName, email, password } = parsed.data;
  if (await findUser(email)) {
    res.status(409).json({ success: false, message: "Email already registered" });
    return;
  }

  let idPengguna: number;
  try {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO Pengguna (nama, email, password, tanggalDaftar)
       VALUES (?, ?, ?, CURRENT_DATE())`,
      [fullName, email, await hashPassword(password)],
    );
    idPengguna = result.insertId;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "ER_DUP_ENTRY") {
      res.status(409).json({ success: false, message: "Email already registered" });
      return;
    }
    throw error;
  }

  try {
    await createAndEmailOtp(idPengguna, email);
  } catch {
    // Account remains unverified; client can use /resend-otp later.
    res
      .status(503)
      .json({
        success: false,
        message: "Account created, but verification email was not sent. Retry verification later.",
      });
    return;
  }
  res
    .status(201)
    .json({ success: true, message: "Registration successful; verify your email with the OTP" });
}

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = parseLogin(req.body);
  if (!parsed.ok) {
    res.status(422).json({ success: false, message: parsed.message });
    return;
  }
  const user = await findUser(parsed.data.email);
  if (!user || !(await verifyPassword(parsed.data.password, user.password))) {
    res.status(401).json({ success: false, message: "Invalid email or password" });
    return;
  }
  if (!user.emailVerifiedAt) {
    res
      .status(403)
      .json({ success: false, message: "Email not verified", code: "EMAIL_NOT_VERIFIED" });
    return;
  }
  const token = await issueAccessToken(user.idPengguna);
  res.json({
    success: true,
    data: { token, user: { id: user.idPengguna, name: user.nama, email: user.email } },
  });
}

export async function resendOtp(req: Request, res: Response): Promise<void> {
  const parsed = parseEmailOnly(req.body);
  if (!parsed.ok) {
    res.status(422).json({ success: false, message: parsed.message });
    return;
  }
  const user = await findUser(parsed.data.email);
  const generic = {
    success: true,
    message: "If this email needs verification, a code will be sent when allowed",
  };
  if (!user || user.emailVerifiedAt) {
    res.json(generic);
    return;
  }
  const [recent] = await pool.execute<ExistsRow[]>(
    `SELECT 1 AS existsRecently FROM email_verification_codes
     WHERE idPengguna = ? AND createdAt > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 60 SECOND) LIMIT 1`,
    [user.idPengguna],
  );
  if (recent.length > 0) {
    res.json(generic);
    return;
  }
  try {
    await createAndEmailOtp(user.idPengguna, user.email);
  } catch {
    // Generic response avoids disclosing registration status.
  }
  res.json(generic);
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const parsed = parseVerification(req.body);
  if (!parsed.ok) {
    res.status(422).json({ success: false, message: parsed.message });
    return;
  }
  const user = await findUser(parsed.data.email);
  if (!user) {
    res.status(400).json({ success: false, message: "Invalid or expired verification code" });
    return;
  }
  if (user.emailVerifiedAt) {
    res.json({ success: true, message: "Email already verified" });
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<OtpRow[]>(
      `SELECT codeHash, attempts, (expiresAt > UTC_TIMESTAMP()) AS isValid
       FROM email_verification_codes WHERE idPengguna = ? FOR UPDATE`,
      [user.idPengguna],
    );
    const record = rows[0];
    if (!record || record.isValid !== 1) {
      await connection.rollback();
      res.status(400).json({ success: false, message: "Invalid or expired verification code" });
      return;
    }
    if (record.attempts >= 5) {
      await connection.rollback();
      res.status(429).json({ success: false, message: "Too many attempts. Request a new code." });
      return;
    }
    if (!otpMatches(user.idPengguna, parsed.data.code, record.codeHash)) {
      await connection.execute(
        "UPDATE email_verification_codes SET attempts = attempts + 1 WHERE idPengguna = ?",
        [user.idPengguna],
      );
      await connection.commit();
      res.status(400).json({ success: false, message: "Invalid or expired verification code" });
      return;
    }
    await connection.execute(
      "UPDATE Pengguna SET emailVerifiedAt = UTC_TIMESTAMP() WHERE idPengguna = ?",
      [user.idPengguna],
    );
    await connection.execute("DELETE FROM email_verification_codes WHERE idPengguna = ?", [
      user.idPengguna,
    ]);
    await connection.commit();
    res.json({ success: true, message: "Email verified; you can now log in" });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function me(_req: Request, res: Response): Promise<void> {
  const id = res.locals.authUserId as number;
  const [rows] = await pool.execute<UserRow[]>(
    "SELECT idPengguna, nama, email, password, emailVerifiedAt FROM Pengguna WHERE idPengguna = ? LIMIT 1",
    [id],
  );
  const user = rows[0];
  if (!user) {
    res.status(404).json({ success: false, message: "User not found" });
    return;
  }
  res.json({
    success: true,
    data: {
      id: user.idPengguna,
      name: user.nama,
      email: user.email,
      emailVerified: Boolean(user.emailVerifiedAt),
    },
  });
}
