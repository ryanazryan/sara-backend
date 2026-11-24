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

export class NlpProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NlpProviderError";
  }
}

type LlmRawOutput = {
  isValidActivityIntent: boolean;
  namaAktivitas: string | null;
  tanggal: string | null; 
  jam: string | null;    
  reminderRequested: boolean;
  missingFields: string[];
  issues: string[];
};

//LLM
export async function interpretIndonesianWithLLM(
  text: string,
  timeZone: string,
  referenceAt: Date = new Date()
): Promise<Interpretation | null> {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai";
  const model = process.env.LLM_MODEL || "gemini-2.5-flash";

  // Jika API key belum diset di .env, fallback ke parser rule-based lama
  if (!apiKey) {
    return interpretIndonesian(text, timeZone, referenceAt);
  }

  const localNow = zoneParts(referenceAt, timeZone);
  const currentLocalDateStr = `${localNow.year}-${String(localNow.month).padStart(2, "0")}-${String(localNow.day).padStart(2, "0")}`;
  const currentLocalTimeStr = `${String(localNow.hour).padStart(2, "0")}:${String(localNow.minute).padStart(2, "0")}`;
  const dayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const localDayName = dayNames[new Date(Date.UTC(localNow.year, localNow.month - 1, localNow.day)).getUTCDay()];

  const systemPrompt = `Kamu adalah Natural Language Parser untuk aplikasi penjadwalan berbahasa Indonesia bernama SARA.
Waktu lokal pengguna saat ini: ${localDayName}, ${currentLocalDateStr} pukul ${currentLocalTimeStr} (${timeZone}).

Tugasmu: Ekstrak maksud kalimat pengguna menjadi JSON murni tanpa markdown atau teks tambahan.

Aturan ketat:
1. Jika kalimat pengguna bukan perintah membuat jadwal/aktivitas/pengingat (misalnya sapaan kosong atau obrolan tidak relevan), set "isValidActivityIntent": false.
2. Bersihkan kata perintah di awal (seperti "tolong ingatkan saya untuk", "buatkan jadwal", "catat") sehingga "namaAktivitas" hanya berisi inti kegiatannya (maksimal 200 karakter).
3. Konversi kata waktu relatif ("hari ini", "besok", "lusa", "senin depan", "akhir pekan", dll) ke tanggal lokal "YYYY-MM-DD" berdasarkan waktu saat ini di atas. Jika pengguna menyebut waktu tanpa tanggal yang pasti atau ambigu, isi "tanggal": null dan masukkan "tanggal" ke "missingFields".
4. Konversi jam ke format 24-jam "HH:mm" (misal "jam 8 malam" -> "20:00", "jam 2 siang" -> "14:00"). Jika user hanya menyebut "jam 8" tanpa keterangan pagi/malam sehingga ambigu, isi "jam": null dan masukkan "waktuMulai" ke "missingFields".
5. Set "reminderRequested": true hanya jika user secara eksplisit meminta diingatkan (mengandung kata "ingatkan", "reminder", "alarm", dsb).
6. Isi "issues" dengan penjelasan singkat bahasa Indonesia jika ada field yang kurang/ambigu.

Format JSON wajib:
{
  "isValidActivityIntent": boolean,
  "namaAktivitas": string | null,
  "tanggal": "YYYY-MM-DD" | null,
  "jam": "HH:mm" | null,
  "reminderRequested": boolean,
  "missingFields": string[],
  "issues": string[]
}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000); // timeout 10 detik

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text.trim() },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new NlpProviderError(`LLM provider error: HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new NlpProviderError("Empty response from LLM provider");
    }

    const parsed = JSON.parse(rawContent) as LlmRawOutput;
    if (!parsed.isValidActivityIntent) return null;

    const missingFields = new Set<string>(parsed.missingFields || []);
    const issues: string[] = [...(parsed.issues || [])];
    let waktuMulai: string | null = null;

    const namaAktivitas = (parsed.namaAktivitas || "").trim();
    if (!namaAktivitas || namaAktivitas.length > 200) {
      missingFields.add("namaAktivitas");
      if (!issues.length) issues.push("Nama aktivitas harus diisi dan maksimal 200 karakter.");
    }

    if (parsed.tanggal && parsed.jam) {
      const [y, m, d] = parsed.tanggal.split("-").map(Number);
      const [hr, min] = parsed.jam.split(":").map(Number);
      waktuMulai = localToUtc({ year: y, month: m, day: d, hour: hr, minute: min }, timeZone);

      if (!waktuMulai) {
        missingFields.add("waktuMulai");
        issues.push("Tanggal/waktu tidak valid atau ambigu pada zona waktu tersebut.");
      } else if (Date.parse(waktuMulai) <= referenceAt.getTime()) {
        missingFields.add("waktuMulai");
        issues.push("Jadwal tidak boleh berada pada waktu yang sudah berlalu.");
        waktuMulai = null;
      }
    } else {
      if (!parsed.tanggal && parsed.jam) missingFields.add("tanggal");
      if (parsed.tanggal && !parsed.jam) missingFields.add("waktuMulai");
    }

    if (parsed.reminderRequested && !waktuMulai) {
      missingFields.add("waktuMulai");
      issues.push("Perintah pengingat membutuhkan tanggal dan waktu yang pasti.");
    }

    const finalMissing = [...missingFields];
    return {
      intent: "CREATE_ACTIVITY",
      state: finalMissing.length > 0 ? "NEEDS_CLARIFICATION" : "READY",
      structuredDraft: {
        namaAktivitas,
        waktuMulai,
        reminderTriggerAt: parsed.reminderRequested ? waktuMulai : null,
        idKegiatan: null,
      },
      missingFields: finalMissing,
      issues,
      referenceAt: referenceAt.toISOString(),
      timeZone,
    };
  } catch (err) {
    if (err instanceof NlpProviderError) throw err;
    throw new NlpProviderError(err instanceof Error ? err.message : "Failed to reach LLM provider");
  } finally {
    clearTimeout(timeoutId);
  }
}