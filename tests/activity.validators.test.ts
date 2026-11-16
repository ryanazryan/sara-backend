import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseAktivitas,
  parseId,
  parseKegiatan,
  parsePagination,
  parseUtcDate,
} from "../src/validators/activity.validators.js";

test("Kegiatan requires a valid name and accepts optional duration", () => {
  assert.equal(parseKegiatan({ namaKegiatan: " Kuliah ", estimasiDurasi: 90 }).ok, true);
  assert.equal(parseKegiatan({ deskripsi: "Only description" }).ok, false);
  assert.equal(parseKegiatan({ namaKegiatan: "Kuliah", idPengguna: 2 }).ok, false);
});

test("Aktivitas supports standalone activities and nullable kategori", () => {
  const parsed = parseAktivitas({
    namaAktivitas: "Belajar mandiri",
    idKegiatan: null,
    kategori: null,
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.data.idKegiatan, null);
    assert.equal(parsed.data.kategori, null);
    assert.equal(parsed.data.status, "TO DO");
  }
});

test("Request cannot set owner ID or unexpected fields", () => {
  assert.equal(parseAktivitas({ namaAktivitas: "X", idPengguna: 5 }).ok, false);
  assert.equal(parseAktivitas({ namaAktivitas: "X", unknown: "Y" }).ok, false);
  assert.equal(parseAktivitas({ namaAktivitas: "X", idKegiatan: -1 }).ok, false);
});

test("Patch validates fields and rejects empty patch", () => {
  assert.equal(parseKegiatan({}, true).ok, false);
  assert.equal(parseAktivitas({}, true).ok, false);
  assert.equal(parseAktivitas({ idKegiatan: null }, true).ok, true);
  assert.equal(parseAktivitas({ kategori: "Akademik" }, true).ok, true);
});

test("Dates require ISO timezone and normalize to UTC", () => {
  assert.equal(parseUtcDate("2026-11-10T09:30:00+07:00"), "2026-11-10 02:30:00");
  assert.equal(parseUtcDate("2026-11-10 09:30:00"), undefined);
  assert.equal(
    parseAktivitas({
      namaAktivitas: "X",
      waktuMulai: "2026-11-10T09:00:00Z",
      waktuSelesai: "2026-11-10T08:00:00Z",
    }).ok,
    false,
  );
});

test("IDs and pagination are bounded integers", () => {
  assert.equal(parseId("123"), 123);
  assert.equal(parseId("0"), null);
  assert.equal(parseId("1 OR 1=1"), null);
  assert.equal(parsePagination({ limit: "20", offset: "0" }).ok, true);
  assert.equal(parsePagination({ limit: "500", offset: "0" }).ok, false);
});
