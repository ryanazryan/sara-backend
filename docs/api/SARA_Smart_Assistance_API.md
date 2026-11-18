# SARA Smart Assistance API — PR #13

> Implementation candidate for `feature/smart-assistance`. These endpoints are not on `main` until the PR merges. This first slice is a **deterministic scheduling assistant**, not an LLM or an automatic calendar optimizer.

## Authentication and data ownership

All endpoints use `Authorization: Bearer <JWT>`; the authenticated user ID comes only from the token. Resource IDs belonging to other users return HTTP 404. No endpoint accepts client-supplied `idPengguna`.

## Endpoints

| Method | Path | Role |
| --- | --- | --- |
| POST | `/api/assistant/suggestions` | Preview available intervals for an existing owned activity; persists a 15-minute draft |
| GET | `/api/assistant/suggestions/:id` | Read an owned draft including expiry/applied state |
| POST | `/api/assistant/suggestions/:id/confirm` | Apply one suggested slot after fresh conflict checks; same selection is idempotent |
| GET | `/api/assistant/priorities?limit=20&offset=0` | Read-only activity ranking by explicit user priority and upcoming start |

### POST `/api/assistant/suggestions`

Example request:

```json
{
  "activityId": 12,
  "windowStart": "2026-12-01T09:00:00+08:00",
  "windowEnd": "2026-12-01T17:00:00+08:00",
  "durationMinutes": 60,
  "bufferMinutes": 15,
  "maxSuggestions": 5
}
```

`activityId` must identify an existing activity owned by the token subject. `windowStart` and `windowEnd` require ISO 8601 plus explicit timezone (`Z` or `±HH:MM`). The start must be in the future and within 30 days; window length must be 15 minutes–24 hours. `durationMinutes` (15–480) is optional **only** if the activity has a usable existing start/end interval. `bufferMinutes` (0–120; default 0) reserves a minimum gap around other activities. `maxSuggestions` (1–5; default 5). Unknown properties are rejected.

Successful response HTTP 201:

```json
{
  "success": true,
  "data": {
    "id": "25f66a91-2e6c-4d40-b00a-7f1a47b493f9",
    "activityId": 12,
    "state": "READY",
    "availableSlots": [
      { "startAt": "2026-12-01T02:00:00Z", "endAt": "2026-12-01T03:00:00Z" }
    ],
    "existingSchedule": { "startAt": null, "endAt": null },
    "window": { "from": "2026-12-01T01:00:00Z", "to": "2026-12-01T09:00:00Z", "durationMinutes": 60, "bufferMinutes": 15 },
    "conflicts": [],
    "requiresReminderReview": false,
    "method": "earliest-free-15-minute-grid",
    "createdAt": "2026-11-18T00:00:00.000Z",
    "expiresAt": "2026-11-18T00:15:00.000Z"
  }
}
```

Times in the example are illustrative. Actual results depend on live owner schedule. When no valid interval is available, HTTP 201 returns `state: "NO_SLOTS"` with `availableSlots: []`; the client should adjust its search window, not attempt to confirm.

`conflicts` lists other **owned** activities intersecting the requested search window, including an `idAktivitas`, name and existing UTC schedule. Completed/cancelled-looking statuses are **not** silently excluded because the backend currently accepts arbitrary status text. Activities with `waktuMulai` but no `waktuSelesai` occupy an assumed 15 minutes. Options use a UTC-aligned 15-minute grid, earliest first, with no overlap between returned candidate slots. This is a transparent scheduling heuristic, not guaranteed optimal optimization. Search result fails with HTTP 409 `SCHEDULE_TOO_LARGE` if over 500 occupied activities need consideration.

### GET `/api/assistant/suggestions/:id`

Returns the stored owned preview. `state` becomes `EXPIRED` in read responses if its 15-minute window has passed. The underlying database retains the original state until cleanup; it is not updated just by reading.

### POST `/api/assistant/suggestions/:id/confirm`

Request:

```json
{ "slotIndex": 0 }
```

The selected `slotIndex` corresponds to `availableSlots` (0-based). After checking the owner, draft expiry, activity fingerprint and currently overlapping schedule, the backend updates `Aktivitas.waktuMulai` and `Aktivitas.waktuSelesai` **in one transaction** with recording the applied suggestion. The existing Activity UPDATE trigger records the change in `aktivitas_history`.

Success HTTP 200:

```json
{
  "success": true,
  "replayed": false,
  "data": {
    "activityId": 12,
    "startAt": "2026-12-01T02:00:00Z",
    "endAt": "2026-12-01T03:00:00Z",
    "remindersUpdated": false,
    "historyRecorded": true
  }
}
```

A repeated confirm using **the same** `slotIndex` returns HTTP 200 and `replayed: true`, with no additional update. A different `slotIndex` returns `409 ALREADY_APPLIED`. Confirm does not create or delete Kegiatan/Aktivitas. It only reschedules the selected existing activity.

**Reminder safety:** If the target has `PENDING` or `DUE` reminders, confirmation returns `409 REMINDERS_REQUIRE_REVIEW`. The client must explicitly cancel/reschedule those reminders before applying; Smart Assistance does not silently rewrite them.

Other conflicts: `409 SUGGESTION_EXPIRED`, `SLOT_PAST`, `ACTIVITY_CHANGED`, `SLOT_CONFLICT`, `NO_SLOTS`. Invalid ID/body/slot => 422; not-owned/missing => 404; missing/invalid JWT => 401.

Concurrency: Confirm serializes Smart Assistance confirmations per user by locking the `Pengguna` row, then checks for schedule conflicts with a locking read. **Other existing CRUD routes do not participate in the same user-lock protocol**; extremely concurrent direct PATCH/POST activity requests can still race against confirmation. Do not claim a global database uniqueness guarantee for time slots. For production-grade no-overlap enforcement, unify scheduling mutations behind a shared transaction/locking protocol.

### GET `/api/assistant/priorities`

Read-only ranking of up to 500 owned activities with `limit` (1–100) and `offset` (0–1,000,000). Returns each activity with `score` and `reasons`. Score is *manual priority* (Tinggi/High = 30, Sedang/Medium = 15, Rendah/Low = 5) plus *upcoming start* (within 24h = +20, within 7d = +10). This is **not a task deadline, machine-learning prediction, or automation of status changes**. Existing arbitrary statuses are not automatically treated as completed. The list endpoint returns 409 `ACTIVITY_SET_TOO_LARGE` above 500 activities and should be upgraded to database-level ranking before large-scale production use.

## Test & migrations

Migration `0014_smart_assistance_suggestions.sql` creates a durable preview table. It is independent of the NLP interpretation table. History and reminder tables from prior PRs are reused.

```bash
DB_NAME=sara_migration_test yarn db:migrate
DB_NAME=sara_migration_test yarn db:migrate:status
yarn typecheck
yarn build
yarn tsc -p tests/tsconfig.json --pretty false
yarn tsx --test tests/smart.validators.test.ts
DB_NAME=sara_migration_test yarn tsx --test tests/smart.api.integration.test.ts
```

Do not run destructive integration tests on `sara` or production. Use the companion Postman Collection for manual testing against a development account.
