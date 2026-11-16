import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseConflictsRange,
  parseHistoryFilters,
  parseScheduleRange,
} from "../src/validators/schedule-history.validators.js";

test("calendar query requires explicit UTC/offset timestamps and ordered range", () => {
  const p = parseScheduleRange({ from: "2026-11-16T08:00:00+07:00", to: "2026-11-16T12:00:00+07:00" });
  assert.equal(p.ok, true);
  if (p.ok) {
    assert.equal(p.data.from, "2026-11-16 01:00:00");
    assert.equal(p.data.to, "2026-11-16 05:00:00");
  }
  assert.equal(parseScheduleRange({ from: "2026-11-16", to: "2026-11-17" }).ok, false);
  assert.equal(parseScheduleRange({ from: "2026-11-18T10:00:00Z", to: "2026-11-17T10:00:00Z" }).ok, false);
  assert.equal(parseScheduleRange({ from: "2026-11-01T00:00:00Z", to: "2027-11-01T00:00:00Z" }).ok, false);
});

test("conflict query accepts optional excluded activity and rejects malformed IDs", () => {
  const p = parseConflictsRange({ startAt: "2026-11-16T01:00:00Z", endAt: "2026-11-16T02:00:00Z", excludeActivityId: "18" });
  assert.equal(p.ok, true);
  if (p.ok) assert.equal(p.data.excludeActivityId, 18);
  assert.equal(parseConflictsRange({ startAt: "2026-11-16T01:00:00Z", endAt: "2026-11-16T02:00:00Z", excludeActivityId: "1 OR 1=1" }).ok, false);
});

test("history filters validate event type and bounded paging", () => {
  assert.equal(parseHistoryFilters({ eventType: "CREATED", activityId: "3", limit: "5" }).ok, true);
  assert.equal(parseHistoryFilters({ eventType: "DROP TABLE" }).ok, false);
  assert.equal(parseHistoryFilters({ limit: "1000" }).ok, false);
});
