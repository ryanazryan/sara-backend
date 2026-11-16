# SARA Backend — API Contract v1 (as implemented)

**Project:** SARA — Smart Assistant for Responsive Automation  
**Source of truth:** `ryanazryan/sara-backend`, branch `main`, after [PR #6](https://github.com/ryanazryan/sara-backend/pull/6) (merged 2026-11-16).  
**Status:** Technical integration reference for the React Native team, documenting the implemented behavior, **not** a promise of unimplemented endpoints.

## 1. General conventions

- **Base URL (backend on local computer):** `http://localhost:3000/api`. For an Android emulator or a physical phone, substitute the appropriate reachable host/IP; `localhost` inside a phone is not the developer PC.
- **Content type:** `application/json` for requests with bodies.
- **Protected endpoints:** `Authorization: Bearer <access_token>`.
- **User IDs and resource IDs:** positive integers. Client must **not** send `idPengguna` to set ownership; backend takes identity from the verified JWT.
- **Authentication token:** HS256 JWT, issued at login, expires in **7 days**. No refresh-token endpoint is currently implemented.
- **OTP:** six decimal digits, expires in **5 minutes**, five failed attempts maximum per issued code, resend cooldown **60 seconds**. Requests to the four auth mutation endpoints share a rate limiter of 20 requests per 15 minutes per client, subject to middleware settings.
- **Success response:** `{ "success": true, ... }`. Data endpoints return `data`; list endpoints also return `pagination`. Some auth endpoints return only `message`. Deletes return HTTP 204 with no body.
- **Failure response:** typically `{ "success": false, "message": "..." }`, and sometimes `code` (notably `EMAIL_NOT_VERIFIED`). There is no unified field-level validation-error object.
- **Pagination:** `limit` defaults to `20`, accepted `1–100`; `offset` defaults to `0`, accepted `0–1000000`. Responses expose `pagination: { limit, offset, count }`, **not a total row count**.
- **Date/time:** For Aktivitas requests, use ISO 8601 with timezone, e.g. `2026-11-16T09:30:00+07:00`. Backend normalizes to UTC MySQL DATETIME and responds with e.g. `2026-11-16T02:30:00Z` or `null`.

## 2. Authentication

### POST `/auth/register` — HTTP 201

Request:

```json
{
  "fullName": "Contoh Pengguna",
  "email": "contoh@example.com",
  "password": "SARA12345",
  "confirmPassword": "SARA12345"
}
```

`confirmPassword` is accepted but optional at the current backend API level; the mobile form should supply it. Email is trimmed and lowercased. `fullName` must contain 2–100 characters including a letter. Password must contain **8–72 non-space characters**, at least one ASCII letter and one digit.

Response:

```json
{ "success": true, "message": "Registration successful; verify your email with the OTP" }
```

No token is returned. Errors include `422` invalid input, `409` email already registered, or `503` account saved but verification email not sent. A `503` after registration should lead to resend flow, not repeated account creation.

### POST `/auth/verify-email` — HTTP 200

Request:

```json
{ "email": "contoh@example.com", "code": "123456" }
```

Response:

```json
{ "success": true, "message": "Email verified; you can now log in" }
```

If already verified, the message is `Email already verified`. Errors include `422` malformed input, `400` invalid/expired code and `429` too many code attempts. Example code above is a placeholder, not a live OTP.

### POST `/auth/resend-otp` — HTTP 200

Request:

```json
{ "email": "contoh@example.com" }
```

Response:

```json
{ "success": true, "message": "If this email needs verification, a code will be sent when allowed" }
```

This intentionally generic response **does not guarantee** an email was sent; it is also used for unknown/verified accounts and cooldown requests. Bad email format returns 422.

### POST `/auth/login` — HTTP 200

Request:

```json
{ "email": "contoh@example.com", "password": "SARA12345" }
```

Successful response (**example token omitted**):

```json
{
  "success": true,
  "data": {
    "token": "<JWT_ACCESS_TOKEN>",
    "user": {
      "id": 1,
      "name": "Contoh Pengguna",
      "email": "contoh@example.com"
    }
  }
}
```

Errors: `422` malformed input, `401` invalid credentials, `403` email unverified with body:

```json
{ "success": false, "message": "Email not verified", "code": "EMAIL_NOT_VERIFIED" }
```

### GET `/auth/me` — HTTP 200 (JWT required)

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Contoh Pengguna",
    "email": "contoh@example.com",
    "emailVerified": true
  }
}
```

Missing/invalid token returns `401` with `Missing or invalid access token`.

## 3. Kegiatan (all endpoints require JWT)

| Method | Path | Success | Purpose |
|---|---|---:|---|
| GET | `/kegiatan?limit=20&offset=0` | 200 | List owned Kegiatan, newest ID first |
| POST | `/kegiatan` | 201 | Create owned Kegiatan |
| GET | `/kegiatan/:id` | 200 | Read owned Kegiatan |
| PATCH | `/kegiatan/:id` | 200 | Modify named fields |
| DELETE | `/kegiatan/:id` | 204 | Delete when it has no attached Aktivitas |

Create request:

```json
{ "namaKegiatan": "Perkuliahan", "deskripsi": "Tugas semester", "estimasiDurasi": 120 }
```

`namaKegiatan` required on create (trimmed nonempty, max 200). `deskripsi` optional text up to 5000 characters or null; `estimasiDurasi` optional integer minutes `0–100000` or null. PATCH accepts any **nonempty subset** of those fields. Unknown properties (including `idPengguna`) are rejected with 422.

Create/read/update `data` shape:

```json
{
  "idKegiatan": 5,
  "namaKegiatan": "Perkuliahan",
  "deskripsi": "Tugas semester",
  "estimasiDurasi": 120
}
```

List response:

```json
{
  "success": true,
  "data": [
    { "idKegiatan": 5, "namaKegiatan": "Perkuliahan", "deskripsi": "Tugas semester", "estimasiDurasi": 120 }
  ],
  "pagination": { "limit": 20, "offset": 0, "count": 1 }
}
```

An unknown/not-owned ID returns `404` (not a user's data). Invalid path IDs return `422`. Deleting a Kegiatan that still has activities returns `409` with a message requiring detach/delete of related Aktivitas; detach by PATCHing each activity `idKegiatan` to null.

## 4. Aktivitas (all endpoints require JWT)

| Method | Path | Success | Purpose |
|---|---|---:|---|
| GET | `/aktivitas?limit=20&offset=0` | 200 | List owned Aktivitas, newest ID first |
| POST | `/aktivitas` | 201 | Create activity, optionally inside Kegiatan |
| GET | `/aktivitas/:id` | 200 | Read owned Aktivitas |
| PATCH | `/aktivitas/:id` | 200 | Modify named fields |
| DELETE | `/aktivitas/:id` | 204 | Delete owned Aktivitas |

Create request:

```json
{
  "namaAktivitas": "Kerjakan laporan",
  "idKegiatan": 5,
  "waktuMulai": "2026-11-16T09:00:00+07:00",
  "waktuSelesai": "2026-11-16T10:30:00+07:00",
  "kategori": "Akademik",
  "prioritas": "Tinggi",
  "lokasi": "Rumah",
  "status": "TO DO"
}
```

Only `namaAktivitas` is required on create (1–200 characters). Other fields are optional. `idKegiatan` can be `null` or omitted, to create a standalone activity; if a non-null ID is supplied it must be owned by the JWT user, otherwise HTTP 422. `kategori` max 100, `prioritas` max 50, `lokasi` max 255; these fields allow null. `waktuMulai`/`waktuSelesai` allow null and require timezone-aware ISO strings when provided. `status` is an arbitrary nonempty string max 50, default `"TO DO"`; there is **no enum-enforced status lifecycle** yet. PATCH accepts a nonempty subset and allows `idKegiatan: null` for detach. Unknown properties are rejected.

Create/read/update `data` shape (example, normalized to UTC):

```json
{
  "idAktivitas": 9,
  "idKegiatan": 5,
  "namaAktivitas": "Kerjakan laporan",
  "waktuMulai": "2026-11-16T02:00:00Z",
  "waktuSelesai": "2026-11-16T03:30:00Z",
  "kategori": "Akademik",
  "prioritas": "Tinggi",
  "lokasi": "Rumah",
  "status": "TO DO"
}
```

List endpoint returns `{ "success": true, "data": [<Aktivitas>], "pagination": { "limit": 20, "offset": 0, "count": 1 } }`. Invalid ID/body/pagination or a Kegiatan not owned by the user returns 422; activity not found/not owned returns 404; deleting returns 204 and no body.

## 5. Health check

`GET /health` (no JWT), e.g.:

```json
{ "success": true, "message": "SARA Backend is running" }
```

## 6. React Native integration notes

The current mobile repo `willysuyanto/sara-mobile` still uses a `stub-token` in `src/hooks/domain/auth/authService.ts`; replace those stubs with real calls via the existing `ky` instance in `src/services/instance.ts`. Mobile `Session` expects `{ email, name, token }`, but backend **login** returns `{ success, data: { token, user: { id, name, email } } }`, so explicitly map `data.user` and `data.token` into the mobile session. Backend **register does not return a session**; adjust the register flow to go to an OTP-verification screen rather than directly logging in. Handle HTTP 403 `EMAIL_NOT_VERIFIED` by navigating to verification, and use secure credential storage for the JWT.

The backend address on a mobile device is **not** `localhost` of the PC. For a stock Android emulator, `http://10.0.2.2:3000/api` often reaches the host; for a physical phone, configure the developer PC's reachable LAN address and network permissions. Test connectivity to `/api/health` first. Verify your React Native environment-variable mechanism actually exposes `API_URL` before using it.

**No current endpoints:** forgot/reset password, refresh token, logout revocation, push notifications, recurring reminders, automatic scheduling, NLP commands, dedicated category CRUD. Do not assume these are implemented.

## 7. Known implementation constraints

- Auth request rate limiting is shared across register/login/verify/resend routes (20 per 15-minute window); do not interpret successful resend response as proof of delivery.
- Backend uses a broad `cors()` configuration; restrict origins before production if exposing a web client.
- Authentication uses a JWT without a refresh-token/revocation system; account disabling/token revocation is not implemented.
- There is no real-time notification delivery or reminder scheduler yet.
- Source is current code on `main`, not a separately versioned public API spec. Revalidate this document after future PRs.

## 8. Source paths

- [Backend API route prefixes](https://github.com/ryanazryan/sara-backend/blob/main/src/routes/index.ts)
- [Auth controller](https://github.com/ryanazryan/sara-backend/blob/main/src/controllers/auth.controller.ts)
- [Activity input validator](https://github.com/ryanazryan/sara-backend/blob/main/src/validators/activity.validators.ts)
- [Kegiatan controller](https://github.com/ryanazryan/sara-backend/blob/main/src/controllers/kegiatan.controller.ts)
- [Aktivitas controller](https://github.com/ryanazryan/sara-backend/blob/main/src/controllers/aktivitas.controller.ts)
- [Mobile auth service (currently stubbed)](https://github.com/willysuyanto/sara-mobile/blob/main/src/hooks/domain/auth/authService.ts)
