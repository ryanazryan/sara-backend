import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNlpRequest, parseConfirmRequest, validInterpretationId } from "../src/validators/nlp.validators.js";
import { interpretIndonesian, localToUtc } from "../src/services/nlp.service.js";

const reference = new Date("2026-11-18T05:00:00Z"); // 13.00 WITA

test("Indonesian reminder text produces a timezone-correct preview", () => {
  const parsed = interpretIndonesian("Ingatkan saya mengerjakan laporan besok jam 8 malam", "Asia/Makassar", reference);
  assert.ok(parsed);
  assert.equal(parsed.state, "READY");
  assert.equal(parsed.intent, "CREATE_ACTIVITY");
  assert.equal(parsed.structuredDraft.namaAktivitas, "mengerjakan laporan");
  assert.equal(parsed.structuredDraft.waktuMulai, "2026-11-19T12:00:00Z");
  assert.equal(parsed.structuredDraft.reminderTriggerAt, "2026-11-19T12:00:00Z");
});

test("unscheduled creation is allowed without a reminder", () => {
  const parsed = interpretIndonesian("Catat tugas membeli susu", "Asia/Jakarta", reference);
  assert.ok(parsed);
  assert.equal(parsed.state, "READY");
  assert.equal(parsed.structuredDraft.waktuMulai, null);
  assert.equal(parsed.structuredDraft.reminderTriggerAt, null);
});

test("create command accepts buat/buatkan and tambah/tambahkan forms", () => {
  for (const text of [
    "Buat aktivitas olahraga",
    "Buatkan aktivitas olahraga",
    "Tambah aktivitas olahraga",
    "Tambahkan aktivitas olahraga",
  ]) {
    const parsed = interpretIndonesian(text, "Asia/Jakarta", reference);
    assert.ok(parsed, `Command should be supported: ${text}`);
    assert.equal(parsed.state, "READY");
    assert.equal(parsed.structuredDraft.namaAktivitas, "olahraga");
    assert.equal(parsed.structuredDraft.reminderTriggerAt, null);
  }
});

test("missing date or ambiguous hour is never silently interpreted", () => {
  const ambiguous = interpretIndonesian("Ingatkan saya bayar listrik besok jam 8", "Asia/Makassar", reference);
  assert.ok(ambiguous);
  assert.equal(ambiguous.state, "NEEDS_CLARIFICATION");
  assert.ok(ambiguous.missingFields.includes("waktuMulai"));
  const missingDate = interpretIndonesian("Jadwalkan rapat pukul 20.00", "Asia/Makassar", reference);
  assert.ok(missingDate);
  assert.equal(missingDate.state, "NEEDS_CLARIFICATION");
  assert.ok(missingDate.missingFields.includes("tanggal"));
  assert.equal(interpretIndonesian("Hapus semua jadwal saya", "Asia/Makassar", reference), null);
});

test("explicit dates, UTC, and DST gaps/overlaps resolve safely", () => {
  const parsed = interpretIndonesian("Jadwalkan rapat 2026-11-20 pukul 20.30", "Asia/Jakarta", reference);
  assert.ok(parsed);
  assert.equal(parsed.state, "READY");
  assert.equal(parsed.structuredDraft.waktuMulai, "2026-11-20T13:30:00Z");
  assert.equal(localToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "America/New_York"), null);
  assert.equal(localToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "America/New_York"), null);
  assert.equal(localToUtc({ year: 2026, month: 11, day: 3, hour: 10, minute: 0 }, "Asia/Makassar"), "2026-11-03T02:00:00Z");
});

test("request and confirmation override validators reject unsafe input", () => {
  assert.equal(parseNlpRequest({ text: "Buat aktivitas belajar", timeZone: "Asia/Makassar" }).ok, true);
  assert.equal(parseNlpRequest({ text: "Buat aktivitas belajar", timeZone: "Mars/Phobos" }).ok, false);
  assert.equal(parseNlpRequest({ text: "Buat aktivitas belajar", timeZone: "Asia/Makassar", idPengguna: 2 }).ok, false);
  assert.equal(parseConfirmRequest({ overrides: { namaAktivitas: " Laporan " } }).ok, true);
  assert.equal(parseConfirmRequest({ overrides: { idPengguna: 99 } }).ok, false);
  assert.equal(parseConfirmRequest({ overrides: { waktuMulai: "tomorrow" } }).ok, false);
  assert.equal(validInterpretationId("not-a-uuid"), false);
});
