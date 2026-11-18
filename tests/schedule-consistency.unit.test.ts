import assert from "node:assert/strict";
import { test } from "node:test";
import { shiftReminderTime, ScheduleConsistencyConflict } from "../src/services/schedule-consistency.service.js";

const now = Date.parse("2028-01-01T00:00:00Z");

test("shifts pending reminder and expiry by the same offset", () => {
  const result = shiftReminderTime("2030-01-01T08:45:00Z", "2030-01-01T09:30:00Z",
    "2030-01-01T09:00:00Z", "2030-01-01T10:00:00Z", now);
  assert.deepEqual(result, { triggerAt: "2030-01-01T09:45:00Z", expiresAt: "2030-01-01T10:30:00Z" });
});

test("shift rejects moving a reminder into the past", () => {
  assert.throws(() => shiftReminderTime("2030-01-01T08:45:00Z", null,
    "2030-01-01T09:00:00Z", "2020-01-01T09:00:00Z", now),
    (error: unknown) => error instanceof ScheduleConsistencyConflict && error.code === "REMINDER_SHIFT_PAST");
});

test("shift rejects unscheduling with active reminders", () => {
  assert.throws(() => shiftReminderTime("2030-01-01T08:45:00Z", null,
    "2030-01-01T09:00:00Z", null, now),
    (error: unknown) => error instanceof ScheduleConsistencyConflict && error.code === "REMINDER_REVIEW_REQUIRED");
});

test("shift leaves no-expiry reminder without expiry", () => {
  assert.deepEqual(shiftReminderTime("2030-01-01T08:45:00Z", null,
    "2030-01-01T09:00:00Z", "2030-01-01T09:30:00Z", now),
    { triggerAt: "2030-01-01T09:15:00Z", expiresAt: null });
});

test("UTC SQL DATETIME and UTC ISO representation yield identical shift", () => {
  const value = shiftReminderTime("2030-01-01T08:45:00Z", null,
    "2030-01-01T09:00:00Z", "2030-01-01 10:00:00", now);
  assert.equal(value.triggerAt, "2030-01-01T09:45:00Z");
});
