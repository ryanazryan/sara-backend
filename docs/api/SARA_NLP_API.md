# SARA — NLP Service API (PR #12)

**Status:** Candidate implementation on `feature/nlp-service`. Endpoint berikut baru tersedia setelah PR #12 di-merge ke `main`.

**Base URL:** `http://localhost:3000/api` · JSON UTF-8 · JWT required.

## Scope dan batasan

Implementasi pertama adalah **parser bahasa Indonesia berbasis aturan**, bukan model bahasa generatif. Mendukung **CREATE_ACTIVITY**, termasuk optional reminder pada perintah "ingatkan". Tidak mengklaim pemahaman semua bentuk bahasa alami. Perintah UPDATE/DELETE/QUERY jadwal, recurring schedule, percakapan bebas, dan AI provider eksternal **belum didukung**; API mengembalikan `422 INTENT_UNSUPPORTED`.

Parser memerlukan `timeZone` IANA eksplisit. Tanggal relatif yang didukung: `hari ini`, `besok`, `lusa`; tanggal absolut: `YYYY-MM-DD`. Waktu: `jam 8 malam`, `jam 9 pagi`, `pukul 20.00`, atau `pukul 20:30`. `jam 8` saja dianggap ambigu. Untuk perintah dengan waktu, **tanggal dan jam harus sama-sama jelas**. Waktu yang sudah lewat, tanggal tidak valid, serta waktu yang hilang/berulang akibat DST tidak ditebak. Aktivitas tanpa jadwal (misalnya "catat tugas membeli susu") boleh dibuat tanpa reminder.

## 1. Parse — POST `/api/ai/parse`

```json
{
  "text": "Ingatkan saya mengerjakan laporan besok jam 8 malam",
  "timeZone": "Asia/Makassar",
  "locale": "id-ID"
}
```

HTTP 200:

```json
{
  "success": true,
  "data": {
    "id": "5379f0b0-4b24-466b-9a8f-56a23537c9c1",
    "intent": "CREATE_ACTIVITY",
    "state": "READY",
    "structuredDraft": {
      "namaAktivitas": "mengerjakan laporan",
      "waktuMulai": "2026-11-19T12:00:00Z",
      "reminderTriggerAt": "2026-11-19T12:00:00Z",
      "idKegiatan": null
    },
    "missingFields": [],
    "issues": [],
    "referenceAt": "2026-11-18T05:00:00.000Z",
    "timeZone": "Asia/Makassar",
    "expiresAt": "2026-11-18T05:15:00.000Z"
  }
}
```

**Contoh hanya ilustratif** dengan asumsi server memproses request pada `2026-11-18T05:00:00Z`. Nilai ID, waktu referensi dan waktu kedaluwarsa aktual dihasilkan server. `referenceAt` menangkap waktu ketika perintah ditafsirkan, supaya "besok" tidak berubah karena pengguna baru mengonfirmasi di hari berikutnya.

Jika waktu ambigu, HTTP 200 tetapi `state = "NEEDS_CLARIFICATION"`, `missingFields` dan `issues` berisi alasan. **Jangan tampilkan tombol Konfirmasi** untuk draft yang belum READY; minta pengguna merevisi teks lalu panggil `/parse` lagi. Input tidak valid atau intent tidak didukung → 422. Parse **tidak menulis Aktivitas/Reminder** dan tidak memanggil FCM.

## 2. Read — GET `/api/ai/interpretations/:id`

HTTP 200 mengembalikan draft milik pengguna JWT. Draft kedaluwarsa akan ditampilkan sebagai `state: "EXPIRED"`; draft yang sudah confirmed memiliki `state: "CONFIRMED"` dan `result` snapshot. ID tidak ditemukan/bukan milik pengguna → 404.

## 3. Confirm — POST `/api/ai/interpretations/:id/confirm`

Body tanpa koreksi:

```json
{}
```

Atau koreksi eksplisit:

```json
{
  "overrides": {
    "namaAktivitas": "Mengerjakan laporan kelompok",
    "waktuMulai": "2026-11-19T20:00:00+08:00",
    "reminderTriggerAt": "2026-11-19T19:45:00+08:00",
    "idKegiatan": null
  }
}
```

Semua field opsional; hanya `namaAktivitas`, `waktuMulai`, `reminderTriggerAt`, dan `idKegiatan` yang diizinkan. `idKegiatan` harus milik JWT user; owner ID dari client ditolak. Jika mengubah `waktuMulai` pada draft yang sudah memiliki reminder, **wajib** menyertakan `reminderTriggerAt` baru atau `null` agar sistem tidak diam-diam meninggalkan pengingat pada jadwal lama.

- **201** pertama: transaksi menyimpan Aktivitas + optional Reminder + snapshot hasil konfirmasi secara atomik. Audit trigger di tabel Aktivitas berjalan otomatis.
- **200** pengulangan dengan body yang sama: mengembalikan `replayed: true` dan snapshot hasil sebelumnya, **tidak membuat aktivitas/reminder kedua**. Dilindungi `SELECT ... FOR UPDATE` pada draft yang menjadi satu-satunya titik serialisasi.
- **409 `CONFIRM_PAYLOAD_CONFLICT`** jika draft telah dikonfirmasi dengan koreksi berbeda.
- **409 `DRAFT_NOT_READY`** jika perlu klarifikasi, atau `DRAFT_EXPIRED` jika TTL 15 menit berakhir. Parse ulang untuk menghasilkan draft baru.
- **422** untuk payload, ID, relasi Kegiatan, dan waktu yang tidak valid. **401** tanpa JWT dan **404** jika draft bukan milik pengguna.

Contoh respons sukses disingkat:

```json
{
  "success": true,
  "replayed": false,
  "data": {
    "interpretationId": "5379f0b0-4b24-466b-9a8f-56a23537c9c1",
    "activity": { "idAktivitas": 42, "namaAktivitas": "mengerjakan laporan", "status": "TO DO", "waktuMulai": "2026-11-19T12:00:00Z" },
    "reminder": { "idReminder": 17, "idAktivitas": 42, "triggerAt": "2026-11-19T12:00:00Z", "status": "PENDING" }
  }
}
```

Contoh `activity` di atas hanya subset kolom untuk keterbacaan. Backend mengembalikan objek aktivitas lengkap sesuai CRUD. Pengingat masuk ke `activity_reminders` dengan `expiresAt = NULL`; status `PENDING` bukan notifikasi yang terkirim.

## Storage, keamanan, dan integrasi

- Migration `0013_nlp_interpretations.sql` menyimpan **structured draft**, status, waktu referensi, batas waktu, hash konfirmasi, dan hasil; **raw user utterance tidak disimpan**.
- Tidak ada panggilan ke AI provider. Parser tidak menggunakan informasi aktivitas pengguna lain.
- Authenticated endpoints: JWT dan owner check pada read serta confirm; `idKegiatan` juga dicek secara transaksional.
- Saat sukses, konfirmasi menyimpan hasil sesuai schema `Aktivitas`/`activity_reminders` yang sudah tersedia; tidak ada mutasi diam-diam pada proses parse.
- Permintaan parse memiliki rate limit **30 request per 15 menit per IP**. Implementasi limiter Express standar bersifat in-memory; untuk multi-instance production perlu store bersama.
- Draft TTL **15 menit** sejak parse. Tidak ada cleanup berkala pada slice ini; data draft kedaluwarsa perlu retention/cleanup policy sebelum produksi.
- Catatan: status dan time zone direkonsiliasi di tingkat backend; jam yang ditampilkan frontend harus dikonversi ke timezone pengguna.

## Testing lokal

```bash
DB_NAME=sara_migration_test yarn db:migrate:status
DB_NAME=sara_migration_test yarn db:migrate
DB_NAME=sara_migration_test yarn db:migrate:status

yarn typecheck
yarn build
yarn tsc -p tests/tsconfig.json --pretty false

yarn tsx --test tests/nlp.validators.test.ts
DB_NAME=sara_migration_test yarn tsx --test tests/nlp.api.integration.test.ts
```

Jangan menjalankan integration test pada database `sara`: test menolak database selain `sara_migration_test` dan melakukan create/delete data pengguna uji. Pertahankan checksums migrasi lama.
