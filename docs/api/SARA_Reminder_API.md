# SARA Reminder Engine API — PR #9

Status: implementation candidate; compare with running API and integration tests before merge.

Base URL: `http://localhost:3000/api` (local dev). All endpoints require `Authorization: Bearer <token>`.
Time inputs are ISO 8601 with explicit timezone (`Z` or `+07:00`). Stored as UTC MySQL DATETIME; output UTC ISO.

| Method | Endpoint | Description |
| --- | --- | --- |
| POST | `/aktivitas/:id/reminders` | Create a reminder on an owned activity |
| GET | `/aktivitas/:id/reminders?limit=20&offset=0` | List reminders of one owned activity |
| GET | `/reminders?status=PENDING&limit=20&offset=0` | List owned reminders; optional status filter |
| GET | `/reminders/:id` | Read one owned reminder |
| PATCH | `/reminders/:id` | Update a PENDING reminder's trigger/expiry |
| DELETE | `/reminders/:id` | Cancel a PENDING or DUE reminder; repeat cancel returns 204 |

## Examples

POST `/api/aktivitas/10/reminders`:
```json
{"triggerAt":"2026-12-01T09:00:00+07:00","expiresAt":"2026-12-01T10:00:00+07:00"}
```

Response `201`:
```json
{"success":true,"data":{"idReminder":1,"idAktivitas":10,"triggerAt":"2026-12-01T02:00:00Z","expiresAt":"2026-12-01T03:00:00Z","status":"PENDING","revision":1,"dueAt":null,"createdAt":"2026-11-16T11:00:00.000000Z","updatedAt":"2026-11-16T11:00:00.000000Z"}}
```

PATCH `/api/reminders/1`:
```json
{"triggerAt":"2026-12-01T09:30:00+07:00","expiresAt":null}
```

Successful GET/list/PATCH responses use `{ "success": true, "data": ... }`; lists include `pagination` (`limit`, `offset`, `count`). DELETE returns HTTP 204 without a body.

## Lifecycle

- `PENDING`: trigger is in the future; rescheduling allowed.
- `DUE`: scheduler has atomically marked a reminder as ready for delivery. **Not proof of notification delivery**.
- `CANCELLED`: user canceled; records retained while parent activity exists.
- `EXPIRED`: past explicit expiry; no further processing.
- Deleting an activity cascades deletes to its reminders. Reminder data is not retained after activity deletion.

`yarn reminders:run` processes one batch; `yarn reminders:worker` polls continuously (default `REMINDER_POLL_MS=10000`). The worker performs only durable DB state transitions and never contacts FCM. FCM/device registration and delivery retries are a separate upcoming PR.

## Status/errors

- 401: missing/invalid JWT
- 404: missing or other user's activity/reminder
- 409: trying to update/cancel a reminder in an unsupported lifecycle state
- 422: invalid ID, dates, fields, range, pagination or status filter

`triggerAt` must be in the future when created/updated; optional `expiresAt` must be later than the trigger. `expiresAt: null` means no server-side expiry (to be reviewed before production). API rejects unknown keys and client-supplied owner IDs. A changed activity schedule does not silently move its reminders; client must update explicitly.

## Known limitations / decisions

- This slice does not provide push notifications, delivery attempts or a durable notification outbox; `DUE` stays queued for future delivery integration.
- Worker can be run independently of React Native. Do not launch multiple worker instances in production without designing queue consumer semantics; DB transition itself is idempotent.
- Lifecycle states of Aktivitas are not finalized; reminders do not auto-cancel on `status` change. Cancels are explicit and activity deletion cascades.
- API currently does not implement idempotency keys or optimistic concurrency. Retention and retry policies remain team decisions.
- The optional `expiresAt` has no default; consider bounding stale DUE entries before FCM integration.
