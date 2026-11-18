import { parseUtcDate } from "./activity.validators.js";

export type Validation<T> = { ok: true; data: T } | { ok: false; message: string };
export type ParseInput = { text: string; timeZone: string; locale: "id-ID" };
export type ConfirmOverrides = {
  namaAktivitas?: string;
  waktuMulai?: string | null;
  reminderTriggerAt?: string | null;
  idKegiatan?: number | null;
};

const invalid = <T>(message: string): Validation<T> => ({ ok: false, message });
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>) : null;
const known = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).every((key) => keys.includes(key));

export function parseNlpRequest(input: unknown): Validation<ParseInput> {
  const data = object(input);
  if (!data || !known(data, ["text", "timeZone", "locale"]))
    return invalid("Invalid NLP request or unexpected field");
  if (typeof data.text !== "string" || data.text.trim().length < 4 || data.text.length > 500)
    return invalid("text must contain 4-500 characters");
  if (data.locale !== undefined && data.locale !== "id-ID")
    return invalid("Only id-ID locale is supported in this version");
  if (typeof data.timeZone !== "string" || data.timeZone.length < 3 || data.timeZone.length > 80)
    return invalid("A valid IANA timeZone is required");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: data.timeZone }).format(new Date());
  } catch {
    return invalid("timeZone must be a recognized IANA timezone");
  }
  return { ok: true, data: { text: data.text.trim(), timeZone: data.timeZone, locale: "id-ID" } };
}

export function parseConfirmRequest(input: unknown): Validation<{ overrides: ConfirmOverrides }> {
  const body = object(input);
  if (!body || !known(body, ["overrides"]))
    return invalid("Confirm body accepts only optional overrides");
  const inputOverrides = body.overrides === undefined ? {} : object(body.overrides);
  if (!inputOverrides || !known(inputOverrides, ["namaAktivitas", "waktuMulai", "reminderTriggerAt", "idKegiatan"]))
    return invalid("Unknown or invalid override field");
  const overrides: ConfirmOverrides = {};
  if (Object.hasOwn(inputOverrides, "namaAktivitas")) {
    const value = inputOverrides.namaAktivitas;
    if (typeof value !== "string" || !value.trim() || value.trim().length > 200)
      return invalid("namaAktivitas must be 1-200 characters");
    overrides.namaAktivitas = value.trim();
  }
  for (const field of ["waktuMulai", "reminderTriggerAt"] as const) {
    if (Object.hasOwn(inputOverrides, field)) {
      const raw = inputOverrides[field];
      const normalized = raw === null ? null : parseUtcDate(raw);
      if (normalized === undefined)
        return invalid(`${field} must be ISO 8601 with timezone or null`);
      overrides[field] = normalized === null ? null : normalized.replace(" ", "T") + "Z";
    }
  }
  if (Object.hasOwn(inputOverrides, "idKegiatan")) {
    const value = inputOverrides.idKegiatan;
    if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 4_294_967_295))
      return invalid("idKegiatan must be a positive integer or null");
    overrides.idKegiatan = value as number | null;
  }
  return { ok: true, data: { overrides } };
}

export function validInterpretationId(input: unknown): input is string {
  return typeof input === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input);
}
