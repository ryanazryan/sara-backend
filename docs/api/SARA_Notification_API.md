# SARA Notification Service & FCM — PR #10 Candidate Contract

Implementation prefix: `/api`. All endpoints below require `Authorization: Bearer <JWT>`.

## Devices

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/devices` | Register/upsert owned installation; 201 new, 200 update |
| GET | `/api/devices` | List own installations; max 100 |
| PATCH | `/api/devices/:id` | Update permission/token of own active installation |
| DELETE | `/api/devices/:id` | Soft-unregister; 204 |

POST body example:

```json
{"installationId":"android-install-1234","platform":"android","notificationPermission":"GRANTED","fcmToken":"your-actual-FCM-registration-token"}
```

`installationId` 8–128 safe characters; `platform`: `android` or `ios`; permission: `GRANTED`, `DENIED`, `UNKNOWN` (default). Optional `fcmToken` may only be sent when permission is `GRANTED`; length 10–4096, no whitespace. `idPengguna` and other fields are forbidden. `PATCH` accepts `notificationPermission` and/or `fcmToken` (`null` revokes). The JWT subject is the owner. Device output **never contains** `fcmToken` or its hash. Re-registering an existing installation with an updated token is supported. A token already bound to another installation/account causes HTTP 409; unregister before switching accounts.

Status: 401 for missing/invalid JWT, 404 for not-owned active device, 422 for invalid inputs, 409 for duplicate token.

## Notifications

`GET /api/notifications?limit=20&offset=0` returns only the caller's notification deliveries, newest first. Each item includes `idNotification`, `idReminder`, `idAktivitas`, `reminderRevision`, `status`, `attempts`, `providerMessageId`, `lastErrorCode`, `createdAt`, `updatedAt`. **No device token is exposed.** Status: `QUEUED`, `SENDING`, `RETRY`, `ACCEPTED`, `FAILED`, or `SKIPPED`.

**ACCEPTED means the FCM HTTP API accepted the message. It does not prove reception or display on the device.** Receipt/read-tracking requires a separate client feature.

## Worker

Run exactly one **notification worker process per deployment replica** or use multiple workers with MySQL row claims. `notifications:run` executes one scheduler/dispatcher cycle; `notifications:worker` polls every `NOTIFICATION_POLL_MS` (default 10000, min 1000, max 60000). It calls the existing reminder scheduler itself; a separate `reminders:worker` is not required when the notification worker is active.

1. Promote due reminders (`PENDING → DUE`) using the existing scheduler.
2. Insert eligible delivery rows for active, granted devices, uniquely keyed by `(idReminder,idDevice,reminderRevision)`.
3. Mark stale/cancelled/expired/revised work `SKIPPED`.
4. Claim queued rows with `SELECT ... FOR UPDATE SKIP LOCKED` and 90-second lease.
5. Send with configured provider. `ACCEPTED` on provider response; otherwise `RETRY` (exponential 30–480s, max five attempts) or `FAILED`. FCM `UNREGISTERED` disables the outdated device token.

Due reminders without expiry are dispatched only during the first 24 hours after `dueAt` to avoid extremely stale notifications. Cancellations or permission changes may still race with an already in-flight external network request. Crash recovery is **at-least-once**, not exactly-once: a send accepted before process crash might be retried after lease recovery. DB uniqueness prevents duplicate outbox rows, not all external duplicate notifications.

## Provider configuration

Development / tests: `NOTIFICATION_PROVIDER=mock` (no external calls). Production: `NOTIFICATION_PROVIDER=fcm` (or production default). Mock mode is prohibited under `NODE_ENV=production`.

Set `FCM_SERVICE_ACCOUNT_FILE` to an **absolute, readable path outside the Git repository** containing Firebase service-account JSON (`project_id`, `client_email`, `private_key`). The backend signs an OAuth 2.0 service-account assertion, exchanges it for a short-lived access token with Google, and calls FCM HTTP v1. **Never commit JSON keys, access tokens, device registration tokens, or server secrets.** A Firebase project, enabled FCM API, and suitable service-account permissions are required. Test real device delivery only after mobile is integrated.

## Tests

```bash
DB_NAME=sara_migration_test yarn db:migrate
DB_NAME=sara_migration_test yarn db:migrate:status
yarn typecheck && yarn build
yarn tsc -p tests/tsconfig.json --pretty false
yarn tsx --test tests/notification.validators.test.ts
DB_NAME=sara_migration_test NOTIFICATION_PROVIDER=mock yarn tsx --test tests/notification.api.integration.test.ts
DB_NAME=sara_migration_test NOTIFICATION_PROVIDER=mock yarn notifications:run
```

Do not aim the destructive integration test at any database other than `sara_migration_test`.
