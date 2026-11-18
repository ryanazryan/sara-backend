import assert from "node:assert/strict";
import { test } from "node:test";
import { findAvailableSlots, priorityScore, snapshotFingerprint } from "../src/services/smart.service.js";
import {
  parsePriorityQuery, parseSmartConfirmation, parseSuggestionRequest, validSmartId,
} from "../src/validators/smart.validators.js";

const future = (hours: number) => new Date(Date.now() + hours * 3600000).toISOString().slice(0, 19) + "Z";

test("strict suggestion input validates bounded future interval and duration", () => {
  assert.equal(parseSuggestionRequest({ activityId: 2, windowStart: future(24), windowEnd: future(30), durationMinutes: 60 }).ok, true);
  assert.equal(parseSuggestionRequest({ activityId: 2, windowStart: "2026-11-19 08:00:00", windowEnd: future(30) }).ok, false);
  assert.equal(parseSuggestionRequest({ activityId: 2, windowStart: future(24), windowEnd: future(30), idPengguna: 99 }).ok, false);
  assert.equal(parseSuggestionRequest({ activityId: -3, windowStart: future(24), windowEnd: future(30) }).ok, false);
  assert.equal(parseSuggestionRequest({ activityId: 2, windowStart: future(24), windowEnd: future(60) }).ok, false);
  assert.equal(parseSuggestionRequest({ activityId: 2, windowStart: future(24), windowEnd: future(30), bufferMinutes: 121 }).ok, false);
});

test("slot finder respects intervals, point-only blocks, buffers and earliest non-overlapping grid", () => {
  const busy = [
    { idAktivitas: 1, namaAktivitas: "Meeting", waktuMulai: "2030-01-01T09:00:00Z", waktuSelesai: "2030-01-01T10:00:00Z" },
    { idAktivitas: 2, namaAktivitas: "Check in", waktuMulai: "2030-01-01T11:00:00Z", waktuSelesai: null },
  ];
  const slots = findAvailableSlots("2030-01-01T09:00:00Z", "2030-01-01T13:00:00Z", 60, busy, 0, 3);
  assert.deepEqual(slots, [
    { startAt: "2030-01-01T10:00:00Z", endAt: "2030-01-01T11:00:00Z" },
    { startAt: "2030-01-01T11:15:00Z", endAt: "2030-01-01T12:15:00Z" },
    { startAt: "2030-01-01T12:15:00Z", endAt: "2030-01-01T13:15:00Z" },
  ].slice(0, 2));
  const buffered = findAvailableSlots("2030-01-01T09:00:00Z", "2030-01-01T12:00:00Z", 30, busy.slice(0, 1), 15, 5);
  assert.equal(buffered[0]?.startAt, "2030-01-01T10:15:00Z");
  assert.deepEqual(findAvailableSlots("2030-01-01T09:00:00Z", "2030-01-01T10:00:00Z", 60, busy, 0, 2), []);
});

test("confirmation selects only a valid option and UUID is strict", () => {
  assert.equal(parseSmartConfirmation({ slotIndex: 0 }).ok, true);
  assert.equal(parseSmartConfirmation({ slotIndex: 1, idPengguna: 9 }).ok, false);
  assert.equal(parseSmartConfirmation({ slotIndex: "0" }).ok, false);
  assert.equal(parseSmartConfirmation({ slotIndex: -1 }).ok, false);
  assert.equal(validSmartId("25f66a91-2e6c-4d40-b00a-7f1a47b493f9"), true);
  assert.equal(validSmartId("../../etc/passwd"), false);
});

test("priority ranking is transparent and never overrides user priority", () => {
  assert.equal(priorityScore("Tinggi", null).score, 30);
  assert.equal(priorityScore("Sedang", null).score, 15);
  assert.equal(priorityScore(null, null).score, 0);
  assert.equal(parsePriorityQuery({ limit: "10", offset: "0" }).ok, true);
  assert.equal(parsePriorityQuery({ idPengguna: "4" }).ok, false);
});

test("snapshot fingerprint changes with schedule and status", () => {
  const original = { idAktivitas: 1, namaAktivitas: "A", waktuMulai: null, waktuSelesai: null,
    status: "TO DO", prioritas: "Tinggi", idKegiatan: null };
  assert.notEqual(snapshotFingerprint(original), snapshotFingerprint({ ...original, status: "DONE" }));
  assert.notEqual(snapshotFingerprint(original), snapshotFingerprint({ ...original, waktuMulai: "2030-01-01T09:00:00Z" }));
});
