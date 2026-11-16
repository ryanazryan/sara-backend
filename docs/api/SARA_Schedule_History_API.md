# SARA — Schedule & Activity History API (Slice 1)

This document records the implemented extension to **`/api`**. All endpoints require `Authorization: Bearer <JWT>`; data is always filtered using the authenticated owner from the JWT. This extends, rather than replaces, `SARA_Backend_API_Contract_v1.md`.

## Endpoints

| Method | URL | Description |
| --- | --- | --- |
| GET | `/api/schedule?from=ISO&to=ISO&limit=20&offset=0` | Owned scheduled activities overlapping a half-open `[from,to)` window |
| GET | `/api/schedule/conflicts?startAt=ISO&endAt=ISO&excludeActivityId=12` | Owned activities with complete intervals overlapping a proposed interval; `excludeActivityId` optional |
| GET | `/api/history?activityId=12&eventType=UPDATED&limit=20&offset=0` | Paginated owned history; both filters optional |
| GET | `/api/aktivitas/:id/history?limit=20&offset=0` | History for an owned activity (including after deletion) |
| POST | `/api/aktivitas/:id/status` | Update status using existing CRUD validator and ownership check, with `{"status":"IN PROGRESS"}` only |

Accepted dates: ISO 8601 with an explicit `Z` or `±HH:MM` offset, e.g. `2026-11-17T09:00:00+07:00`. Backend normalizes incoming times to UTC. Schedule range maximum: 90 days. Page limit defaults to 20 and maxes at 100; offset defaults to 0 and maxes at 1,000,000. `from`/`to` and `startAt`/`endAt` must be ordered.

`/api/schedule` includes entries with a start time; it treats entries without `waktuSelesai` as point events and intervals with a defined end as overlapping if `waktuMulai < to AND waktuSelesai > from`. `/api/schedule/conflicts` considers only activities with both start and end defined, and currently includes all statuses; terminal-status policy remains a team decision. Conflicts are diagnostic only: they do not mutate an activity or reject a schedule change. Results are capped at 100 matches for the initial version.

Response examples:

```json
{
  "success": true,
  "data": [{
    "idAktivitas": 1,
    "idKegiatan": null,
    "namaAktivitas": "Rapat",
    "waktuMulai": "2026-11-17T02:00:00Z",
    "waktuSelesai": "2026-11-17T03:00:00Z",
    "kategori": "Kuliah",
    "prioritas": null,
    "lokasi": null,
    "status": "TO DO"
  }],
  "pagination": { "limit": 20, "offset": 0, "count": 1 },
  "range": { "from": "2026-11-16T17:00:00Z", "to": "2026-11-17T17:00:00Z" }
}
```

```json
{
  "success": true,
  "data": [{
    "idHistory": 1,
    "idAktivitas": 1,
    "eventType": "CREATED",
    "oldStatus": null,
    "newStatus": "TO DO",
    "changes": { "after": { "namaAktivitas": "Rapat", "status": "TO DO" } },
    "occurredAt": "2026-11-17T02:01:00.000000Z"
  }],
  "pagination": { "limit": 20, "offset": 0, "count": 1 }
}
```

`GET /api/schedule/conflicts` returns `{"success":true,"data":{"conflicts":[...]}}`. `POST /api/aktivitas/:id/status` returns the updated Aktivitas in the same shape as PATCH `/api/aktivitas/:id`.

## Audit and deletion semantics

Migrations `0006` through `0009` create a history table and three **MySQL triggers**, which record `CREATED`, `UPDATED` and `DELETED` events **in the same transaction as the source mutation**. A hard-deleted activity still has queryable history for its owner. No foreign key from the audit row to a deleted activity is created, intentionally. User deletion cascades history removal. The `changes` object captures the before/after Activity fields, not passwords or OTP tokens. Physical DELETE semantics in the existing CRUD API are unchanged.

Note that legacy activities created *before* this migration do not gain historical events retroactively. The first event recorded for a legacy activity will be its next update or deletion. Routine status transitions are not yet constrained to a finalized enum; this endpoint reuses existing `status` validation (nonempty ≤50 chars). Proper lifecycle values/transitions and automatic cancellation of future reminders must be decided and enforced as a follow-up.

## Errors and authentication

- 401 Missing/invalid Bearer token
- 404 Activity ID not owned or unknown (per-activity history/status)
- 422 Invalid IDs, range, pagination, or request body
- 200 Successful GET or status change

## Local verification

```bash
DB_NAME=sara_migration_test yarn db:migrate:status
DB_NAME=sara_migration_test yarn db:migrate
DB_NAME=sara_migration_test yarn db:migrate:status
yarn typecheck
yarn build
yarn tsc -p tests/tsconfig.json --pretty false
yarn tsx --test tests/schedule-history.validators.test.ts
DB_NAME=sara_migration_test yarn tsx --test tests/schedule-history.api.integration.test.ts
```

**Do not apply unreviewed migrations on production.** MySQL triggers require the database user's `TRIGGER` privilege. Existing migration checksums must not be rewritten. Verify test DB selection before running the write test.
