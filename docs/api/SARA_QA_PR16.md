# SARA Backend Integration & Quality Assurance — PR #16

## Tujuan

Menambahkan quality gate otomatis tanpa mengubah endpoint aplikasi atau database migration.
Baseline adalah `main` setelah PR #15. Fokus: seluruh unit/regression test,
perlindungan JWT, rollback transaksi, OpenAPI inventory, dan CI dengan MySQL 8.

## Commands (Windows Git Bash / CI)

```bash
cd /d/project/sara-backend

# Tanpa MySQL
node scripts/run-tests.mjs --list
yarn typecheck
yarn build
yarn tsc -p tests/tsconfig.json --pretty false
yarn qa:contract
yarn test:unit

# Tes integrasi dapat INSERT/DELETE; gunakan DB khusus!
DB_NAME=sara_migration_test yarn db:migrate:status
DB_NAME=sara_migration_test yarn db:migrate
DB_NAME=sara_migration_test yarn test:integration

# Menjalankan unit lalu integration, SELALU dengan DB khusus
DB_NAME=sara_migration_test yarn test:all
```

`test:integration` dan `test:all` menolak berjalan apabila
`DB_NAME` bukan persis `sara_migration_test`. Setiap file test berjalan dalam
proses Node terpisah, berurutan: beberapa integration test lama memanggil
`pool.end()`. Jangan jalankan semua integration test dalam satu proses `--test`.

## GitHub Actions

File `.github/workflows/backend-ci.yml` menjalankan dua job pada PR ke `main`
dan push ke `main`:

1. **Static + unit:** Yarn immutable install, source/test TypeScript check,
   build, routes/Postman/OpenAPI drift check, dan seluruh unit/auth boundary tests.
2. **MySQL integration:** Container MySQL 8, database `sara_migration_test`,
   migrasi `0001–0014`, lalu semua integration test secara serial. Provider
   notifikasi disetel `mock` dan tidak menghubungi layanan FCM nyata.

CI memakai secret **khusus pengujian publik**, bukan secret produksi.
Credential CI adalah data dummy; jangan salin ke production `.env`.
CI tidak memerlukan Resend API key untuk test yang tersedia sekarang.

## API contract

`docs/api/SARA_OpenAPI_v1.yaml` adalah **inventaris endpoint OpenAPI 3.0**,
39 operasi HTTP pada 28 path. Schema request/response masih sebagian: field
khusus dan edge case tetap mengikuti `src/validators/` dan dokumen modul
`docs/api/`. Jangan menjanjikan output kode client otomatis yang lengkap
sebelum penyempurnaan field-level schema.

`yarn qa:contract` membandingkan:
- route registrations dari `src/routes/index.ts` dan tiap `*.routes.ts`;
- HTTP method/path unik pada Postman Collection utama;
- method/path yang tercatat pada file OpenAPI.

Pemeriksa ini mendeteksi *drift daftar endpoint*, bukan kesesuaian JSON schema,
validasi runtime, izin CORS, ataupun correctness bisnis.

## Uji tambahan

- `qa.auth-boundary.test.ts`: endpoint yang dilindungi harus membalas `401`
  sebelum validator/controller/DB berjalan, baik token tidak ada maupun palsu.
- `qa.rollback.api.integration.test.ts`: pengguna B tidak dapat PATCH data
  pengguna A; jika pergeseran jadwal akan membuat reminder `PENDING` lewat,
  server membalas `409` dan mempertahankan Activity, Reminder, dan audit history.

## Limitasi / follow-ups

- Belum ada pengujian perangkat React Native, FCM real, email Resend real,
  atau load/performance test.
- OpenAPI belum memiliki complete field-level response schemas.
- Static contract checker hanya mengenali deklarasi Express `router.get/post/...`
  statis; jika kelak routing dinamis, update checker terlebih dahulu.
- Beberapa status HTTP pada Postman memerlukan uji manual. Jangan menjalankan
  semua Postman requests sekaligus karena ada perintah DELETE/mutasi.
- Lakukan branch protection di GitHub secara manual setelah CI pertama hijau:
  wajibkan dua status check `Static checks, contract and unit tests` dan
  `MySQL migration and end-to-end API regression` sebelum merge.
