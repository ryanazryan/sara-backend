import { parseId, parsePagination, parseUtcDate } from "./activity.validators.js";

type Validation<T> = { ok: true; data: T } | { ok: false; message: string };
export type SuggestRequest = {
  activityId: number;
  windowStart: string;
  windowEnd: string;
  durationMinutes: number | null;
  bufferMinutes: number;
  maxSuggestions: number;
};
const invalid = <T>(message: string): Validation<T> => ({ ok: false, message });
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>) : null;

export function parseSuggestionRequest(value: unknown, now = Date.now()): Validation<SuggestRequest> {
  const body = asRecord(value);
  if (!body || Object.keys(body).some((k) => ![
    "activityId", "windowStart", "windowEnd", "durationMinutes", "bufferMinutes", "maxSuggestions",
  ].includes(k))) return invalid("Invalid suggestion body or unexpected field");

  const activityId = body.activityId;
  if (typeof activityId !== "number" || !Number.isSafeInteger(activityId) || activityId < 1 || activityId > 4_294_967_295) {
    return invalid("activityId must be a positive integer");
  }
  const start = parseUtcDate(body.windowStart);
  const end = parseUtcDate(body.windowEnd);
  if (typeof start !== "string" || typeof end !== "string") {
    return invalid("windowStart and windowEnd must be ISO 8601 with explicit timezone");
  }
  const fromMs = Date.parse(start.replace(" ", "T") + "Z");
  const toMs = Date.parse(end.replace(" ", "T") + "Z");
  const span = toMs - fromMs;
  if (!Number.isFinite(span) || fromMs <= now || span < 15 * 60_000 || span > 24 * 60 * 60_000 || fromMs > now + 30 * 24 * 60 * 60_000) {
    return invalid("Search window must start in future, be 15 minutes to 24 hours, and start within 30 days");
  }
  const durationRaw = body.durationMinutes;
  if (durationRaw !== undefined && (!Number.isSafeInteger(durationRaw) || typeof durationRaw !== "number" || durationRaw < 15 || durationRaw > 480)) {
    return invalid("durationMinutes must be 15-480");
  }
  const bufferMinutes = body.bufferMinutes ?? 0;
  if (typeof bufferMinutes !== "number" || !Number.isSafeInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 120) {
    return invalid("bufferMinutes must be 0-120");
  }
  const maxSuggestions = body.maxSuggestions ?? 5;
  if (typeof maxSuggestions !== "number" || !Number.isSafeInteger(maxSuggestions) || maxSuggestions < 1 || maxSuggestions > 5) {
    return invalid("maxSuggestions must be 1-5");
  }
  return { ok: true, data: { activityId, windowStart: start, windowEnd: end,
    durationMinutes: durationRaw === undefined ? null : durationRaw as number,
    bufferMinutes, maxSuggestions } };
}

export function parseSmartConfirmation(value: unknown): Validation<{ slotIndex: number }> {
  const body = asRecord(value);
  if (!body || Object.keys(body).length !== 1 || !Object.hasOwn(body, "slotIndex") ||
      typeof body.slotIndex !== "number" || !Number.isSafeInteger(body.slotIndex) ||
      body.slotIndex < 0 || body.slotIndex > 4) return invalid("Provide only slotIndex (0-4)");
  return { ok: true, data: { slotIndex: body.slotIndex } };
}

export function validSmartId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parsePriorityQuery(value: unknown): Validation<{ limit: number; offset: number }> {
  const q = asRecord(value);
  if (!q || Object.keys(q).some((key) => key !== "limit" && key !== "offset")) {
    return invalid("Only limit and offset query parameters are allowed");
  }
  return parsePagination(q);
}
