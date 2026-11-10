// Native JavaScript Regular Expressions: SARA Week 9 validation evidence.
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const NAME_REGEX = /[\p{L}]/u;
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)\S{8,72}$/;
export const OTP_REGEX = /^\d{6}$/;

export type RegisterInput = { fullName: string; email: string; password: string };
export type LoginInput = { email: string; password: string };
export type EmailInput = { email: string };
export type VerifyEmailInput = { email: string; code: string };

type Valid<T> = { ok: true; data: T };
type Invalid = { ok: false; message: string };
type Validation<T> = Valid<T> | Invalid;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_REGEX.test(email) ? email : null;
}

export function parseRegister(value: unknown): Validation<RegisterInput> {
  const input = asRecord(value);
  if (!input) return { ok: false, message: "Invalid request body" };
  const email = parseEmail(input.email);
  const fullName = typeof input.fullName === "string" ? input.fullName.trim() : "";
  const password = input.password;
  if (!email) return { ok: false, message: "Invalid email address" };
  if (fullName.length < 2 || fullName.length > 100 || !NAME_REGEX.test(fullName)) {
    return { ok: false, message: "Full name must contain 2-100 characters and a letter" };
  }
  if (typeof password !== "string" || !PASSWORD_REGEX.test(password)) {
    return {
      ok: false,
      message: "Password must be 8-72 characters and contain letters and numbers without spaces",
    };
  }
  if (input.confirmPassword !== undefined && input.confirmPassword !== password) {
    return { ok: false, message: "Password confirmation does not match" };
  }
  return { ok: true, data: { fullName, email, password } };
}

export function parseLogin(value: unknown): Validation<LoginInput> {
  const input = asRecord(value);
  if (!input) return { ok: false, message: "Invalid request body" };
  const email = parseEmail(input.email);
  if (!email || typeof input.password !== "string" || input.password.length === 0) {
    return { ok: false, message: "Invalid email or password format" };
  }
  return { ok: true, data: { email, password: input.password } };
}

export function parseEmailOnly(value: unknown): Validation<EmailInput> {
  const input = asRecord(value);
  const email = parseEmail(input?.email);
  return email ? { ok: true, data: { email } } : { ok: false, message: "Invalid email address" };
}

export function parseVerification(value: unknown): Validation<VerifyEmailInput> {
  const input = asRecord(value);
  const email = parseEmail(input?.email);
  if (!email || typeof input?.code !== "string" || !OTP_REGEX.test(input.code)) {
    return { ok: false, message: "Invalid email or verification code" };
  }
  return { ok: true, data: { email, code: input.code } };
}
