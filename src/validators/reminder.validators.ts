import { parsePagination, parseUtcDate } from "./activity.validators.js";

type Validation<T> = { ok: true; data: T } | { ok: false; message: string };
export type ReminderFields = { triggerAt?: string; expiresAt?: string | null };

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  return Object.keys(result).every((key) => key === "triggerAt" || key === "expiresAt")
    ? result
    : null;
}

export function parseReminder(value: unknown, patch = false): Validation<ReminderFields> {
  const body = record(value);
  if (!body) return { ok: false, message: "Invalid reminder body or unexpected field" };
  const data: ReminderFields = {};
  if (Object.hasOwn(body, "triggerAt")) {
    const parsed = parseUtcDate(body.triggerAt);
    if (typeof parsed !== "string") {
      return { ok: false, message: "triggerAt must be an ISO 8601 timestamp with timezone" };
    }
    data.triggerAt = parsed;
  } else if (!patch) {
    return { ok: false, message: "triggerAt is required" };
  }
  if (Object.hasOwn(body, "expiresAt")) {
    const parsed = parseUtcDate(body.expiresAt);
    if (parsed === undefined) {
      return { ok: false, message: "expiresAt must be an ISO 8601 timestamp or null" };
    }
    data.expiresAt = parsed;
  }
  if (patch && Object.keys(data).length === 0) {
    return { ok: false, message: "No reminder fields to update" };
  }
  if (data.expiresAt && data.triggerAt && data.expiresAt <= data.triggerAt) {
    return { ok: false, message: "expiresAt must be later than triggerAt" };
  }
  return { ok: true, data };
}

export function isFutureReminder(triggerAt: string, expiresAt: string | null): boolean {
  const now = Date.now();
  const trigger = Date.parse(triggerAt.replace(" ", "T") + "Z");
  if (!Number.isFinite(trigger) || trigger <= now) return false;
  if (expiresAt === null) return true;
  const expiry = Date.parse(expiresAt.replace(" ", "T") + "Z");
  return Number.isFinite(expiry) && expiry > trigger;
}

export function parseReminderList(value: unknown): Validation<{
  status: "PENDING" | "DUE" | "CANCELLED" | "EXPIRED" | null;
  limit: number;
  offset: number;
}> {
  const paging = parsePagination(value);
  if (!paging.ok) return paging;
  const query = value as Record<string, unknown>;
  const status = query.status;
  if (
    status !== undefined && status !== "PENDING" && status !== "DUE" &&
    status !== "CANCELLED" && status !== "EXPIRED"
  ) {
    return { ok: false, message: "Invalid reminder status filter" };
  }
  return { ok: true, data: { ...paging.data, status: status ?? null } };
}
