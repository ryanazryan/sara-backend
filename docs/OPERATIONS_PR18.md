# PR #18 — Monitoring & reliability operations

## What's included

- JSON-lines logs for HTTP completion, unhandled errors, and worker ticks/errors. Every request has `X-Request-ID`.
- Only allowlisted metadata is logged: timestamp, event, request ID, method, route template, response status and duration. **No Authorization headers, request bodies, raw URLs/query strings, token values, email or database errors** are written by the new logger.
- `GET /api/health` is the unchanged public liveness endpoint (Node/Express process is running).
- `GET /api/ready` is a public **database connectivity** check. It returns `200 {"success":true,"status":"ready"}` after `SELECT 1`, or `503 {"success":false,"status":"not_ready"}` otherwise, without exposing credentials.
- The API handles `SIGTERM`/`SIGINT`: stop accepting HTTP, drain active requests, end MySQL pool, then exit. A 15-second hard deadline prevents a hung shutdown.
- `scripts/docker-db-backup.mjs` creates a local SQL dump without putting DB passwords on the host command line. The dump includes MySQL triggers and migration history.

## Verification (Git Bash, repository root)

```bash
yarn typecheck && yarn build
yarn tsc -p tests/tsconfig.json --pretty false
yarn qa:contract
yarn test:unit
DB_NAME=sara_migration_test yarn test:integration
```

The integration runner refuses `DB_NAME` other than `sara_migration_test`. For Docker:

```bash
docker compose --env-file .env.docker build api
docker compose --env-file .env.docker up -d --wait api worker
node scripts/docker-smoke.mjs
```

Smoke checks `/api/health` (200), `/api/ready` (200) and `/api/auth/me` without JWT (401).

## Viewing logs and investigating incidents

```bash
docker compose --env-file .env.docker logs --tail=100 api worker
curl -i http://127.0.0.1:3000/api/ready
```

Correlate incidents by `X-Request-ID` rather than logging private payloads. HTTP 500 errors in logs contain only the error type. Never copy secrets, SQL dumps or raw JWTs into issue reports.

## Database backups (operator-initiated)

Run while the MySQL service is healthy:

```bash
node scripts/docker-db-backup.mjs
```

The script creates a private SQL file under `backups/` (Git-ignored), and deletes partial dumps on failure. **Backups contain potentially sensitive user data**. Restrict host access, encrypt before copying to offsite storage, maintain retention policies and regularly test restore on an isolated staging database. Windows file-mode bits may not restrict access like Linux; protect the folder with OS permissions.

Use `node scripts/docker-db-backup.mjs /absolute/private/backup-directory` to choose a private destination. Do not put the backup file inside a public webroot or Git repository. Backups are **not automated or offsite** by this PR.

To inspect an existing dump safely, first restore into a separate disposable MySQL instance/database (not the live SARA database), and confirm the expected tables, triggers and migration history. Production recovery requires a documented and practiced restore/rollback process; schema downgrades are not automatic.

## Scope / limitations

This PR provides structured application logs, basic readiness, graceful shutdown and a manual backup tool. It does **not** yet provide a centralized log service, alert delivery, automated offsite backup, external uptime checks, DB replica or real Firebase delivery. `GET /api/ready` checks connectivity only; it does not validate schema revisions, Redis, Resend, FCM or worker backlog. For a public production release, add operational alerting, a verified backup restore drill, and protect secrets outside source control.
