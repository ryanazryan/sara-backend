// Payload validation for SARA's Kegiatan and Aktivitas Candidate MVP APIs.
// User ownership is derived exclusively from JWT; never from request bodies.

type Valid<T> = { ok: true; data: T };
type Invalid = { ok: false; message: string };
export type Validation<T> = Valid<T> | Invalid;

export type KegiatanFields = {
  namaKegiatan?: string;
  deskripsi?: string | null;
  estimasiDurasi?: number | null; // minutes
};

export type AktivitasFields = {
  namaAktivitas?: string;
  idKegiatan?: number | null;
  waktuMulai?: string | null; // MySQL UTC DATETIME
  waktuSelesai?: string | null;
  kategori?: string | null;
  prioritas?: string | null;
  lokasi?: string | null;
  status?: string;
};

const kegiatanKeys = new Set(["namaKegiatan", "deskripsi", "estimasiDurasi"]);
const aktivitasKeys = new Set([
  "namaAktivitas",
  "idKegiatan",
  "waktuMulai",
  "waktuSelesai",
  "kategori",
  "prioritas",
  "lokasi",
  "status",
]);

function record(input: unknown, allowed: ReadonlySet<string>): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  return Object.keys(data).every((key) => allowed.has(key)) ? data : null;
}

function invalid<T>(message: string): Validation<T> {
  return { ok: false, message };
}

export function parseId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n <= 4_294_967_295 ? n : null;
}

export function parsePagination(value: unknown): Validation<{ limit: number; offset: number }> {
  if (typeof value !== "object" || value === null) return invalid("Invalid query");
  const query = value as Record<string, unknown>;
  const limitRaw = query.limit ?? "20";
  const offsetRaw = query.offset ?? "0";
  if (
    typeof limitRaw !== "string" ||
    typeof offsetRaw !== "string" ||
    !/^[1-9]\d*$/.test(limitRaw) ||
    !/^(0|[1-9]\d*)$/.test(offsetRaw)
  ) {
    return invalid("limit and offset must be nonnegative integer strings (limit at least 1)");
  }
  const limit = Number(limitRaw);
  const offset = Number(offsetRaw);
  if (
    !Number.isSafeInteger(limit) ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset > 1_000_000
  ) {
    return invalid("limit must be 1-100 and offset must be 0-1000000");
  }
  return { ok: true, data: { limit, offset } };
}

function text(value: unknown, max: number, nullable: boolean): string | null | undefined {
  if (nullable && value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined;
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed || null : undefined;
}

// Accept explicit-zone ISO strings only; normalize to UTC for MySQL DATETIME.
// Example: 2026-11-10T09:30:00+07:00 -> 2026-11-10 02:30:00
export function parseUtcDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    return undefined;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function parseKegiatan(input: unknown, patch = false): Validation<KegiatanFields> {
  const body = record(input, kegiatanKeys);
  if (!body) return invalid("Invalid Kegiatan body or unexpected field");
  const data: KegiatanFields = {};
  if (Object.hasOwn(body, "namaKegiatan")) {
    const name = text(body.namaKegiatan, 200, false);
    if (typeof name !== "string") return invalid("namaKegiatan must be 1-200 characters");
    data.namaKegiatan = name;
  } else if (!patch) return invalid("namaKegiatan is required");
  if (Object.hasOwn(body, "deskripsi")) {
    const desc = optionalText(body.deskripsi, 5000);
    if (desc === undefined)
      return invalid("deskripsi must be text (up to 5000 characters) or null");
    data.deskripsi = desc;
  }
  if (Object.hasOwn(body, "estimasiDurasi")) {
    const duration = body.estimasiDurasi;
    if (
      duration !== null &&
      (typeof duration !== "number" ||
        !Number.isSafeInteger(duration) ||
        duration < 0 ||
        duration > 100_000)
    ) {
      return invalid("estimasiDurasi must be minutes (0-100000) or null");
    }
    data.estimasiDurasi = duration as number | null;
  }
  if (patch && Object.keys(data).length === 0) return invalid("No fields to update");
  return { ok: true, data };
}

export function parseAktivitas(input: unknown, patch = false): Validation<AktivitasFields> {
  const body = record(input, aktivitasKeys);
  if (!body) return invalid("Invalid Aktivitas body or unexpected field");
  const data: AktivitasFields = {};
  if (Object.hasOwn(body, "namaAktivitas")) {
    const name = text(body.namaAktivitas, 200, false);
    if (typeof name !== "string") return invalid("namaAktivitas must be 1-200 characters");
    data.namaAktivitas = name;
  } else if (!patch) return invalid("namaAktivitas is required");

  if (Object.hasOwn(body, "idKegiatan")) {
    const id = body.idKegiatan;
    if (
      id !== null &&
      (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || id > 4_294_967_295)
    ) {
      return invalid("idKegiatan must be a positive integer or null");
    }
    data.idKegiatan = id as number | null;
  }
  for (const field of ["kategori", "prioritas", "lokasi"] as const) {
    if (Object.hasOwn(body, field)) {
      const parsed = optionalText(body[field], field === "lokasi" ? 255 : 100);
      if (
        parsed === undefined ||
        (field === "prioritas" && parsed !== null && parsed.length > 50)
      ) {
        return invalid(`${field} has an invalid length or type`);
      }
      data[field] = parsed;
    }
  }
  for (const field of ["waktuMulai", "waktuSelesai"] as const) {
    if (Object.hasOwn(body, field)) {
      const parsed = parseUtcDate(body[field]);
      if (parsed === undefined) return invalid(`${field} must be ISO 8601 with timezone or null`);
      data[field] = parsed;
    }
  }
  if (Object.hasOwn(body, "status")) {
    const parsed = text(body.status, 50, false);
    if (typeof parsed !== "string") return invalid("status must be 1-50 characters");
    data.status = parsed;
  } else if (!patch) data.status = "TO DO";

  if (data.waktuMulai && data.waktuSelesai && data.waktuSelesai < data.waktuMulai) {
    return invalid("waktuSelesai must not be earlier than waktuMulai");
  }
  if (patch && Object.keys(data).length === 0) return invalid("No fields to update");
  return { ok: true, data };
}
