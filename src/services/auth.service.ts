import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify } from "jose";

const scryptAsync = promisify(scrypt);
const HASH_SCHEME = "scrypt";

function secretBytes(name: "JWT_SECRET" | "OTP_PEPPER"): Uint8Array {
  const secret = process.env[name];
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error(`${name} must be set to at least 32 bytes`);
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${HASH_SCHEME}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (
    scheme !== HASH_SCHEME ||
    !saltHex ||
    !keyHex ||
    saltHex.length !== 32 ||
    keyHex.length !== 128
  ) {
    return false;
  }
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(keyHex)) return false;
  const actual = (await scryptAsync(password, Buffer.from(saltHex, "hex"), 64)) as Buffer;
  const expected = Buffer.from(keyHex, "hex");
  return timingSafeEqual(actual, expected);
}

export function createOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function otpDigest(idPengguna: number, code: string): string {
  return createHmac("sha256", secretBytes("OTP_PEPPER"))
    .update(`${idPengguna}:${code}`)
    .digest("hex");
}

export function otpMatches(idPengguna: number, code: string, stored: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(stored)) return false;
  return timingSafeEqual(
    Buffer.from(otpDigest(idPengguna, code), "hex"),
    Buffer.from(stored, "hex"),
  );
}

export async function issueAccessToken(idPengguna: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(String(idPengguna))
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretBytes("JWT_SECRET"));
}

export async function verifyAccessToken(token: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, secretBytes("JWT_SECRET"), {
      algorithms: ["HS256"],
    });
    const id = Number(payload.sub);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}
