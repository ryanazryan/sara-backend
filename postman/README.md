# Postman — SARA Backend (hingga PR #13)

Collection dan environment ini dibuat berdasarkan routes/controllers/validators pada branch `main` setelah PR #13 merged. **NLP dan Smart Assistance tersedia; forgot password belum tersedia.**

## Import dan konfigurasi

1. Jalankan MySQL lokal dan backend: `yarn dev` (default port `3000`).
2. Buka Postman → **Import** → pilih `SARA_Backend.postman_collection.json` dan `SARA_Local.postman_environment.json`.
3. Pilih environment **SARA Local** pada pojok kanan atas Postman.
4. Isi `baseUrl`: `http://localhost:3000/api` untuk desktop/Postman lokal; ubah bila memakai server lain.
5. Isi `email`, `password`, dan saat menerima kode email isi `otpCode`. Gunakan akun khusus development, bukan akun utama.
6. **Auth → Register**, **Verify email OTP**, **Login · capture JWT**; akses token otomatis disimpan sebagai environment `accessToken` dan diterapkan sebagai `Bearer` pada request protected.
7. Jalankan **Create Kegiatan**, **Create Aktivitas**, **Create Reminder**, dan **Register/Upsert Device**. ID tersimpan otomatis di environment (`kegiatanId`, `aktivitasId`, `reminderId`, `deviceId`).

> Kode OTP harus dibaca dari email dan dimasukkan secara manual. Resend OTP `200` tidak menjamin email dikirim. Register tidak langsung mengembalikan JWT; login baru bisa dilakukan setelah OTP terverifikasi.

## Urutan pengujian workflow

| Tahap | Request Postman | Hasil yang diharapkan |
| --- | --- | --- |
| 1 | 00 Health → Health check | `200` |
| 2 | 01 Authentication → Register / Verify / Login / Me | `201` / `200` / `200` / `200` |
| 3 | 02 Kegiatan → Create | `201`, menyimpan `kegiatanId` |
| 4 | 03 Aktivitas → Create | `201`, menyimpan `aktivitasId` |
| 5 | 03 Aktivitas → Update (hubungkan Kegiatan) | `200` |
| 6 | 04 Schedule & History → Calendar / Conflicts / History | `200` |
| 7 | 05 Reminders → Create | `201`, menyimpan `reminderId` |
| 8 | 06 Devices → Register / Upsert | `201` atau `200`, menyimpan `deviceId` |
| 9 | 07 Notifications → List | `200`; data bisa kosong |
| 10 | 08 Negative Tests → Unauthorized Me | `401` |

Setiap request memiliki contoh body dan assertion status. **Jangan menggunakan Collection Runner terhadap seluruh request sekaligus**, karena request DELETE dan status change bersifat mutatif serta urutan data penting.

## Tanggal otomatis

Collection-level pre-request script menghasilkan `activityStartAt`, `activityEndAt`, `reminderTriggerAt`, `reminderExpiresAt`, `scheduleFrom`, `scheduleTo`, dan waktu conflict. Semua memakai ISO 8601 timezone `Z`, relatif terhadap saat request. Karena itu tidak perlu mengganti tanggal contoh setiap hari.

## Worker dan pengiriman notifikasi

Server API saja tidak otomatis menjalankan worker. Gunakan terminal terpisah:

```bash
# Worker sekali jalan (manual)
NOTIFICATION_PROVIDER=mock yarn notifications:run

# Worker berulang (development)
NOTIFICATION_PROVIDER=mock yarn notifications:worker
```

Notification worker juga memproses reminder yang jatuh tempo. Reminder contoh dibuat **2 jam di masa depan**, jadi jika worker langsung dijalankan, hasil `0 due` atau `0 queued` **normal**. Untuk menguji flow delivery cepat, buat reminder dengan trigger beberapa menit mendatang lalu tunggu jadwalnya; jangan mengubah jam DB atau memakai tanggal yang sudah lewat, sebab validator menolak reminder masa lalu.

Default `fcmToken` environment adalah token **palsu untuk provider mock**, bukan token FCM nyata. Untuk real FCM: daftarkan token perangkat asli, gunakan provider `fcm` dengan service account yang benar, dan verifikasi pada perangkat. Status `ACCEPTED` belum berarti notifikasi tampil di perangkat.

## Keamanan dan kolaborasi

- Jangan commit atau membagikan Postman environment berisi **nilai runtime** dari `accessToken`, password akun asli, OTP, atau token perangkat nyata. File environment di repository hanya contoh.
- `accessToken` diperoleh dari login dan disimpan dalam environment Postman lokal. Kosongkan/reset setelah pengujian.
- Environment `SARA Local` hanya template. Untuk tim mobile, `localhost` di emulator/perangkat tidak mengarah ke komputer developer. Android emulator lazim memakai `10.0.2.2:3000`, dan perangkat fisik butuh IP LAN komputer.
- Gunakan database development `sara` untuk tes manual. Jangan menjalankan integration test otomatis pada database selain `sara_migration_test`; tes dapat menulis/menghapus data.
- Saat account tidak dapat menerima OTP dari Resend sender development, jangan paksa token manual sebagai bypass; koordinasikan verified sender/domain atau akun uji yang sudah terverifikasi.

## Hal yang belum tersedia di main

Forgot/reset password, refresh token, endpoint revoke logout, recurring reminders, serta statistik produktivitas lanjutan belum tersedia pada baseline ini.


## NLP & Smart Assistance (PR #12–#13)

Setelah login dan Create Aktivitas, jalankan grup `09 · NLP` untuk parse/confirm perintah bahasa alami atau grup `10 · Smart Assistance (PR #13)` untuk mencari slot kosong. Pada Smart Assistance, request Create akan menyimpan `smartSuggestionId` otomatis, lalu Read menampilkan slot dan Confirm mengubah jadwal aktivitas **hanya ketika Anda menjalankannya secara eksplisit**. Jika aktivitas memiliki reminder aktif, konfirmasi akan ditolak sampai reminder ditinjau/dibatalkan. Request dapat menghasilkan `NO_SLOTS` apabila rentang penuh. Jangan menjalankan request mutatif secara massal.
