import { parseId, parsePagination, parseUtcDate } from "./activity.validators.js";

type Validation<T> = { ok: true; data: T } | { ok: false; message: string };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseScheduleRange(value: unknown): Validation<{
  from: string;
  to: string;
  limit: number;
  offset: number;
}> {
  const q = object(value);
  if (!q) return { ok: false, message: "Invalid query" };
  const from = parseUtcDate(q.from);
  const to = parseUtcDate(q.to);
  if (typeof from !== "string" || typeof to !== "string" || from >= to) {
    return { ok: false, message: "from and to must be ordered ISO 8601 timestamps with timezone" };
  }
  // A bounded window prevents excessively broad calendar scans.
  const span = Date.parse(to.replace(" ", "T") + "Z") - Date.parse(from.replace(" ", "T") + "Z");
  if (!Number.isFinite(span) || span > 90 * 24 * 60 * 60 * 1000) {
    return { ok: false, message: "Schedule range must not exceed 90 days" };
  }
  const paging = parsePagination(q);
  if (!paging.ok) return paging;
  return { ok: true, data: { from, to, ...paging.data } };
}

export function parseConflictsRange(value: unknown): Validation<{
  start: string;
  end: string;
  excludeActivityId: number | null;
}> {
  const q = object(value);
  if (!q) return { ok: false, message: "Invalid query" };
  const start = parseUtcDate(q.startAt);
  const end = parseUtcDate(q.endAt);
  if (typeof start !== "string" || typeof end !== "string" || start >= end) {
    return { ok: false, message: "startAt must be before endAt (ISO 8601 with timezone)" };
  }
  const exclude = q.excludeActivityId;
  const excludeActivityId = exclude === undefined ? null : parseId(exclude);
  if (exclude !== undefined && excludeActivityId === null) {
    return { ok: false, message: "excludeActivityId must be a positive integer" };
  }
  return { ok: true, data: { start, end, excludeActivityId } };
}

export function parseHistoryFilters(value: unknown): Validation<{
  activityId: number | null;
  eventType: "CREATED" | "UPDATED" | "DELETED" | null;
  limit: number;
  offset: number;
}> {
  const q = object(value);
  if (!q) return { ok: false, message: "Invalid query" };
  const paging = parsePagination(q);
  if (!paging.ok) return paging;
  const activityId = q.activityId === undefined ? null : parseId(q.activityId);
  if (q.activityId !== undefined && activityId === null) {
    return { ok: false, message: "activityId must be a positive integer" };
  }
  const type = q.eventType;
  if (type !== undefined && type !== "CREATED" && type !== "UPDATED" && type !== "DELETED") {
    return { ok: false, message: "eventType must be CREATED, UPDATED or DELETED" };
  }
  return { ok: true, data: { activityId, eventType: type ?? null, ...paging.data } };
}
