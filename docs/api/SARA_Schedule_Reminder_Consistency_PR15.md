# SARA — Schedule & Reminder Consistency (PR #15)

Base: current `/api` contracts. No migration or new endpoint. JWT and ownership rules remain unchanged.

## Problem and policy

- The existing activity CRUD contract **permits overlapping times**. The `GET /api/schedule/conflicts` endpoint remains diagnostic. This PR does NOT introduce a global rule that every Activity must have a unique free slot.
- To protect Smart Assistance's *conflict-aware confirmation*, all participating **schedule mutation paths** acquire a `Pengguna` row lock before touching Activity rows. Specifically: Activity POST/PATCH/DELETE, NLP confirmation (which creates an activity), and Smart Assistance confirmation. Concurrent writes from those APIs serialize **per owner**, rather than across all users.
- Manual Reminder POST/PATCH/DELETE now follow the same lock order, before locking reminder rows.
- Smart Assistance still re-checks the slot while holding the owner lock. If another cooperating writer commits a conflict first, confirm returns `409 SLOT_CONFLICT`. Ordinary CRUD can still deliberately create an overlapping activity **after** a Smart confirmation. This is the documented policy, not a guarantee against all overlaps.

## Rescheduling PENDING reminders

When `PATCH /api/aktivitas/:id` changes `waktuMulai`, all active **PENDING** reminders shift by precisely the difference between the old and new start time, including optional `expiresAt`. The shift is performed in the **same MySQL transaction** as the Activity UPDATE, so all reminders and activity either commit or roll back together. Reminder revision is incremented.

Example:

- Activity initially 10:00 UTC; Reminder 09:45 UTC (15 minutes before).
- Activity moved to 11:00 UTC; Reminder becomes 10:45 UTC. An expiry of 10:30 UTC becomes 11:30 UTC.
- `PATCH` with unrelated fields does not shift the reminders. Changing only `waktuSelesai` does not shift reminders.
- Unscheduled Activity with an active Reminder cannot be scheduled or unscheduled via start-time change without manual reminder review; existing temporal relationship is unknown.

The following changes return `409` **without modifying Activity or Reminder**:

| Code | Meaning | Frontend action |
|---|---|---|
| `REMINDER_REVIEW_REQUIRED` | `DUE` reminder exists or Activity start time is removed/unavailable | Review/cancel affected reminders first |
| `REMINDER_SHIFT_PAST` | Shift would place a reminder in the past | Cancel or explicitly change the reminder first |

When Smart Assistance confirmation moves an Activity, it uses the same reminder shift behavior rather than always returning `REMINDERS_REQUIRE_REVIEW`. Its result includes `remindersUpdated` (boolean) and `shiftedReminders` (integer); existing fields remain. The suggestion's `requiresReminderReview` preview field still signals that reminders exist, so the frontend should display their impact before confirmation.

## Safety and limitations

- All time comparisons explicitly normalize MySQL UTC DATETIME and ISO `Z` as UTC. Machine locale must not shift reminder times.
- Due reminders cannot be safely un-sent, so only **PENDING** reminders shift. CANCELED/EXPIRED reminders are untouched.
- Reminder worker can promote a reminder to `DUE` concurrently; row locks serialize this with the shift; the request may return `409` if promotion wins.
- This PR is not a comprehensive global scheduler. Direct SQL writes, custom cron jobs, and future endpoints that don't follow the owner-lock protocol may still race with Smart confirmation. Add `lockScheduleOwner` first in new transactional writers.
- Pending reminders created manually are shifted by the activity's start-time delta **regardless of user intent**. Frontend should tell users and allow explicit reminder edits before/after rescheduling.
- `POST /api/assistant/suggestions` remains a preview and can become stale; final confirmation checks for changes.
- Use `sara_migration_test` for destructive automated tests. Production MySQL migrations remain at 14.

## Testing

```bash
yarn typecheck
yarn build
yarn tsc -p tests/tsconfig.json --pretty false
yarn tsx --test tests/schedule-consistency.unit.test.ts
DB_NAME=sara_migration_test yarn tsx --test tests/schedule-consistency.api.integration.test.ts
DB_NAME=sara_migration_test yarn tsx --test tests/smart.api.integration.test.ts
DB_NAME=sara_migration_test yarn tsx --test tests/nlp.api.integration.test.ts
DB_NAME=sara_migration_test yarn tsx --test tests/reminder.api.integration.test.ts
DB_NAME=sara_migration_test NOTIFICATION_PROVIDER=mock yarn tsx --test tests/notification.api.integration.test.ts
```
