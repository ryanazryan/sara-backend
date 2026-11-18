import { createHash } from "node:crypto";

export type Slot = { startAt: string; endAt: string };
export type ScheduledItem = {
  idAktivitas: number;
  namaAktivitas: string;
  waktuMulai: string | null;
  waktuSelesai: string | null;
};
export type TargetSnapshot = {
  idAktivitas: number;
  namaAktivitas: string;
  waktuMulai: string | null;
  waktuSelesai: string | null;
  status: string;
  prioritas: string | null;
  idKegiatan: number | null;
};

export const sqlToIso = (sql: string): string => `${sql.replace(" ", "T")}Z`;
export const isoToSql = (iso: string): string => iso.replace("T", " ").replace("Z", "").slice(0, 19);
const ms = (iso: string): number => Date.parse(iso);
const minute = 60_000;
const quarter = 15 * minute;

// Include schedule + descriptive fields so a changed activity cannot silently
// receive a stale recommendation. Hash does not contain user secrets.
export function snapshotFingerprint(target: TargetSnapshot): string {
  return createHash("sha256").update(JSON.stringify([
    target.idAktivitas, target.namaAktivitas, target.waktuMulai, target.waktuSelesai,
    target.status, target.prioritas, target.idKegiatan,
  ])).digest("hex");
}

// An activity with only start time is conservatively treated as a 15-minute
// block. Status is deliberately not interpreted: current status enum is open.
export function collectOccupied(items: ScheduledItem[], bufferMinutes: number): Array<[number, number]> {
  return items.flatMap((item) => {
    if (!item.waktuMulai) return [];
    const start = ms(item.waktuMulai);
    const finish = item.waktuSelesai ? ms(item.waktuSelesai) : start + quarter;
    if (!Number.isFinite(start) || !Number.isFinite(finish) || finish <= start) return [];
    return [[start - bufferMinutes * minute, finish + bufferMinutes * minute] as [number, number]];
  }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// Deterministic 15-minute grid; candidate slots do not overlap one another.
// No preference for late/early times is invented beyond "earliest available".
export function findAvailableSlots(
  from: string, to: string, durationMinutes: number,
  items: ScheduledItem[], bufferMinutes = 0, maxSuggestions = 5,
): Slot[] {
  const fromMs = ms(from);
  const toMs = ms(to);
  const length = durationMinutes * minute;
  if (!(toMs > fromMs) || length <= 0) return [];
  const intervals: Array<[number, number]> = [];
  for (const [a, b] of collectOccupied(items, bufferMinutes)) {
    const lo = Math.max(fromMs, a);
    const hi = Math.min(toMs, b);
    if (hi <= lo) continue;
    const last = intervals.at(-1);
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else intervals.push([lo, hi]);
  }
  const out: Slot[] = [];
  const append = (freeStart: number, freeEnd: number): void => {
    let cursor = Math.ceil(freeStart / quarter) * quarter;
    while (cursor + length <= freeEnd && out.length < maxSuggestions) {
      out.push({ startAt: new Date(cursor).toISOString().slice(0, 19) + "Z",
        endAt: new Date(cursor + length).toISOString().slice(0, 19) + "Z" });
      cursor += Math.max(length, quarter);
    }
  };
  let cursor = fromMs;
  for (const [lo, hi] of intervals) {
    append(cursor, lo);
    if (out.length === maxSuggestions) return out;
    cursor = Math.max(cursor, hi);
  }
  append(cursor, toMs);
  return out;
}

export function priorityScore(priority: string | null, startAt: string | null, now = Date.now()): {
  score: number; reasons: string[];
} {
  const p = priority?.trim().toLowerCase();
  const weight = p === "tinggi" || p === "high" ? 30 : p === "sedang" || p === "medium" ? 15 : p === "rendah" || p === "low" ? 5 : 0;
  const reasons: string[] = [];
  if (weight) reasons.push(`Prioritas pengguna: ${priority}`);
  const delta = startAt ? ms(startAt) - now : Infinity;
  const soon = delta >= 0 && delta <= 24 * 60 * minute ? 20 : delta >= 0 && delta <= 7 * 24 * 60 * minute ? 10 : 0;
  if (soon) reasons.push(soon === 20 ? "Mulai dalam 24 jam" : "Mulai dalam 7 hari");
  if (!reasons.length) reasons.push("Tidak ada sinyal prioritas yang dikenali");
  return { score: weight + soon, reasons };
}
