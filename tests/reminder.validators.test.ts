import assert from "node:assert/strict";
import { test } from "node:test";
import { isFutureReminder, parseReminder, parseReminderList } from "../src/validators/reminder.validators.js";

const iso = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString().slice(0, 19) + "Z";

test("reminder create requires timestamp with explicit timezone", () => {
  assert.equal(parseReminder({}).ok, false);
  assert.equal(parseReminder({ triggerAt: "2026-12-01 10:00:00" }).ok, false);
  assert.equal(parseReminder({ triggerAt: "2026-12-01T10:00:00+07:00" }).ok, true);
  const parsed = parseReminder({ triggerAt: "2026-12-01T10:00:00+07:00" });
  if (parsed.ok) assert.equal(parsed.data.triggerAt, "2026-12-01 03:00:00");
});

test("reminders reject unrecognized fields and invalid expiry", () => {
  assert.equal(parseReminder({ triggerAt: iso(3600000), idPengguna: 5 }).ok, false);
  assert.equal(parseReminder({ triggerAt: iso(3600000), expiresAt: iso(1800000) }).ok, false);
  assert.equal(parseReminder({ expiresAt: null }, true).ok, true);
  assert.equal(parseReminder({}, true).ok, false);
});

test("a reminder must be future and expire after its trigger", () => {
  const start = iso(3600000).replace("T", " ").replace("Z", "");
  const expiry = iso(7200000).replace("T", " ").replace("Z", "");
  assert.equal(isFutureReminder(start, null), true);
  assert.equal(isFutureReminder(start, expiry), true);
  assert.equal(isFutureReminder(expiry, start), false);
  assert.equal(isFutureReminder("2000-01-01 00:00:00", null), false);
});

test("reminder list pagination and status filter are validated", () => {
  assert.equal(parseReminderList({ status: "DUE", limit: "5", offset: "0" }).ok, true);
  assert.equal(parseReminderList({ status: "SENT" }).ok, false);
  assert.equal(parseReminderList({ limit: "999" }).ok, false);
});
