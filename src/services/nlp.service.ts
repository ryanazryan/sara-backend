// Deterministic Indonesian MVP parser. Never stores the raw utterance or
// invokes an external model; unrecognized intents and ambiguous time fail safe.
export type Draft = {
  namaAktivitas: string;
  waktuMulai: string | null;
  reminderTriggerAt: string | null;
  idKegiatan: null;
};
export type Interpretation = {
  intent: "CREATE_ACTIVITY";
  state: "READY" | "NEEDS_CLARIFICATION";
  structuredDraft: Draft;
  missingFields: string[];
  issues: string[];
  referenceAt: string;
  timeZone: string;
};

type CalendarParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
function zoneParts(date: Date, timeZone: string): CalendarParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = (key: string): number => Number(parts.find((p) => p.type === key)?.value);
  return { year: value("year"), month: value("month"), day: value("day"),
    hour: value("hour"), minute: value("minute"), second: value("second") };
}

// Find a unique UTC instant for the requested local wall clock. DST gaps and
// overlaps are ambiguous and never silently resolved to an arbitrary instant.
export function localToUtc(date: { year: number; month: number; day: number; hour: number; minute: number }, timeZone: string): string | null {
  const naive = Date.UTC(date.year, date.month - 1, date.day, date.hour, date.minute, 0);
  const same = new Date(naive);
  if (same.getUTCFullYear() !== date.year || same.getUTCMonth() + 1 !== date.month || same.getUTCDate() !== date.day ||
      same.getUTCHours() !== date.hour || same.getUTCMinutes() !== date.minute) return null;
  const offsets = new Set<number>();
  for (const delta of [-86_400_000, 0, 86_400_000]) {
    const instant = naive + delta;
    const p = zoneParts(new Date(instant), timeZone);
    offsets.add(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant);
  }
  const matches: number[] = [];
  for (const offset of offsets) {
    const instant = naive - offset;
    const p = zoneParts(new Date(instant), timeZone);
    if (p.year === date.year && p.month === date.month && p.day === date.day &&
        p.hour === date.hour && p.minute === date.minute && p.second === 0) matches.push(instant);
  }
  return matches.length === 1 ? new Date(matches[0]).toISOString().slice(0, 19) + "Z" : null;
}

function resolveClock(rawHour: number, minute: number, part?: string): number | null {
  if (!Number.isInteger(rawHour) || !Number.isInteger(minute) || minute > 59 || minute < 0) return null;
  if (part) {
    if (rawHour < 1 || rawHour > 12) return null;
    switch (part.toLowerCase()) {
      case "pagi": return rawHour === 12 ? null : rawHour;
      case "siang": return rawHour === 12 ? 12 : rawHour >= 1 && rawHour <= 3 ? rawHour + 12 : null;
      case "sore": return rawHour >= 3 && rawHour <= 6 ? rawHour + 12 : null;
      case "malam": return rawHour === 12 ? 0 : rawHour >= 6 && rawHour <= 11 ? rawHour + 12 : null;
      default: return null;
    }
  }
  // A written 24-hour clock is unambiguous; "jam 8" is not.
  if (rawHour >= 0 && rawHour <= 23 && (rawHour >= 13 || rawHour === 0)) return rawHour;
  return null;
}

export function interpretIndonesian(text: string, timeZone: string, referenceAt: Date = new Date()): Interpretation | null {
  const input = text.trim().replace(/\s+/g, " ");
  const prefix = /^(?:(?:tolong|mohon)\s+)?(ingatkan(?:\s+saya)?(?:\s+untuk)?|buat(?:kan)?(?:\s+(?:saya|aktivitas|tugas|jadwal))?|catat(?:kan)?(?:\s+(?:saya|aktivitas|tugas))?|tambah(?:kan)?(?:\s+(?:aktivitas|tugas))?|jadwalkan(?:\s+saya)?)(?:\s+|$)/i;
  const verb = input.match(prefix);
  if (!verb) return null;
  const reminderRequested = /^ingatkan/i.test(verb[1]);
  let remainder = input.slice(verb[0].length).trim();
  const issues: string[] = [];
  const missingFields: string[] = [];
  const clockExpression = /\b(?:jam|pukul)\s*(\d{1,2})(?:[.:](\d{2}))?\s*(pagi|siang|sore|malam)?\b/i;
  const clock = remainder.match(clockExpression);
  const hasClockWord = /\b(?:jam|pukul)\b/i.test(remainder);
  const dayExpression = /\b(hari ini|besok|lusa)\b/i;
  const day = remainder.match(dayExpression);
  const isoDay = remainder.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const explicitDay = Boolean(day || isoDay);
  const suspiciousDate = /\b(?:tanggal|minggu depan|senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu)\b/i.test(remainder);
  const localNow = zoneParts(referenceAt, timeZone);
  let calendar = { year: localNow.year, month: localNow.month, day: localNow.day };
  if (day) {
    const shift = day[1].toLowerCase() === "besok" ? 1 : day[1].toLowerCase() === "lusa" ? 2 : 0;
    const d = new Date(Date.UTC(calendar.year, calendar.month - 1, calendar.day + shift));
    calendar = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  } else if (isoDay) {
    calendar = { year: Number(isoDay[1]), month: Number(isoDay[2]), day: Number(isoDay[3]) };
  }
  const hour = clock ? resolveClock(Number(clock[1]), Number(clock[2] ?? "0"), clock[3]) : null;
  let waktuMulai: string | null = null;
  if (hasClockWord || explicitDay || suspiciousDate) {
    if (!explicitDay || (isoDay && day) || suspiciousDate) {
      missingFields.push("tanggal");
      issues.push("Tanggal belum jelas; gunakan 'hari ini', 'besok', 'lusa', atau YYYY-MM-DD.");
    }
    if (hour === null) {
      missingFields.push("waktuMulai");
      issues.push("Waktu belum jelas; gunakan misalnya 'jam 8 malam' atau 'pukul 20.00'.");
    }
    if (explicitDay && !suspiciousDate && !(isoDay && day) && hour !== null) {
      waktuMulai = localToUtc({ ...calendar, hour, minute: Number(clock?.[2] ?? "0") }, timeZone);
      if (!waktuMulai) {
        missingFields.push("waktuMulai");
        issues.push("Tanggal/waktu tidak valid atau ambigu karena transisi timezone.");
      }
    }
  }
  if (waktuMulai && Date.parse(waktuMulai) <= referenceAt.getTime()) {
    missingFields.push("waktuMulai");
    issues.push("Jadwal tidak boleh berada pada waktu yang sudah berlalu dalam perintah ini.");
    waktuMulai = null;
  }
  if (reminderRequested && !waktuMulai) {
    if (!missingFields.includes("waktuMulai")) missingFields.push("waktuMulai");
    issues.push("Perintah pengingat membutuhkan tanggal dan waktu yang pasti.");
  }
  if (clock) remainder = remainder.replace(clock[0], " ");
  if (day) remainder = remainder.replace(day[0], " ");
  if (isoDay) remainder = remainder.replace(isoDay[0], " ");
  if (/\b(?:hari ini|besok|lusa|jam|pukul|tanggal)\b|\b\d{4}-\d{2}-\d{2}\b/i.test(remainder)) {
    if (!missingFields.includes("waktuMulai")) missingFields.push("waktuMulai");
    issues.push("Ada ekspresi tanggal/jam tambahan atau tidak dikenal; tulis ulang perintah secara jelas.");
  }
  const namaAktivitas = remainder.replace(/^\s*(?:untuk|agar)\s+/i, "")
    .replace(/[.!?,;:\s]+$/g, "").replace(/\s+/g, " ").trim();
  if (!namaAktivitas || namaAktivitas.length > 200) {
    missingFields.push("namaAktivitas");
    issues.push("Nama aktivitas harus diisi dan maksimal 200 karakter.");
  }
  return {
    intent: "CREATE_ACTIVITY",
    state: missingFields.length ? "NEEDS_CLARIFICATION" : "READY",
    structuredDraft: { namaAktivitas, waktuMulai, reminderTriggerAt: reminderRequested ? waktuMulai : null, idKegiatan: null },
    missingFields: [...new Set(missingFields)], issues,
    referenceAt: referenceAt.toISOString(), timeZone,
  };
}
