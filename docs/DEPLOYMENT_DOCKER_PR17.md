# PR #17 — Docker deployment & smoke testing

## Scope and safety

This stack runs **MySQL 8**, a **one-shot migration service**, the **Express API**, and **one notification worker**. The notification worker already calls `processDueReminders()`. Running a second reminder loop is unnecessary. No schema changes are introduced by PR #17; the current version has 14 migrations.

This Compose configuration is intended for **local deployment verification and small controlled environments**, not an out-of-the-box internet-facing production deployment. It does not provide TLS, backup automation, a secret manager, monitoring, or real FCM validation. The HTTP health endpoint is **liveness only** and does not prove database readiness after startup. CI exercises a separate DB connectivity check.

## Requirements

- Docker Engine/Desktop with Docker Compose v2 and access to Docker Hub, plus Git Bash/PowerShell on Windows.
- At least 2–4 GB free memory for Docker Desktop, with MySQL 8 and Node 24 images.
- Keep existing Laragon MySQL and local `.env` files untouched. Docker uses its **own named volume**, private Docker network, and separate `.env.docker` settings.

## First run (Git Bash, project root)

```bash
cd /d/project/sara-backend
cp .env.docker.example .env.docker
```

Edit **`.env.docker`** and fill at least `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, `JWT_SECRET`, `OTP_PEPPER`. Use **four distinct unpredictable secrets**; for each one you may generate a value locally using:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Do not copy the example file's empty secret values into a running deployment. `.env.docker` is covered by `.gitignore`. Never commit it or a Firebase JSON key. Keep `NODE_ENV=development` and `NOTIFICATION_PROVIDER=mock` for the first local smoke test.

```bash
docker compose --env-file .env.docker config --quiet
docker compose --env-file .env.docker build
docker compose --env-file .env.docker up -d --wait api worker
docker compose --env-file .env.docker ps
node scripts/docker-smoke.mjs
```

Expected: `mysql` healthy; `migrate` exited 0; `api` healthy; `worker` running. HTTP smoke prints `PASS Docker smoke: /api/health 200; /api/auth/me 401 without JWT`. Migration is idempotent and must finish before the API starts. The MySQL service publishes **no host port**, and the API is bound to `127.0.0.1:3000` by default. If local port 3000 is occupied, set `SARA_API_PORT=3001` in `.env.docker` and run `node scripts/docker-smoke.mjs http://127.0.0.1:3001`.

Check database access and migrations:

```bash
docker compose --env-file .env.docker run --rm --no-deps migrate node dist/config/database-check.js
docker compose --env-file .env.docker run --rm --no-deps migrate node dist/db/migrate.js status
docker compose --env-file .env.docker logs --tail=80 api worker migrate
```

Expected migration status is **14 files, pending 0** for the current main. To stop without deleting MySQL data:

```bash
docker compose --env-file .env.docker down
```

**Never** run `docker compose down -v` on an environment containing important data: the `-v` flag deletes the named MySQL volume.

## Migrations & updates

1. Back up your database (and test restore) before deploying code or applying a new migration.
2. Review all pending SQL files; migrations can auto-commit DDL. A partially failed migration is marked `running` and needs manual recovery. Never edit previously applied migration files.
3. Build from a reviewed Git commit; preferably pin the Node and MySQL image versions by digest for a release.
4. Execute migrations with `docker compose --env-file .env.docker run --rm migrate` during a maintenance window. Confirm exit code 0 and `status` pending 0 before allowing traffic.
5. Restart API and worker after the migration; watch logs, health and notification queue. Rollback of a code release does **not** automatically roll back the database schema.

The Compose dependency `service_completed_successfully` gates **initial startup**. It is not an online schema migration/zero-downtime guarantee. To rebuild the local stack after a source change:

```bash
docker compose --env-file .env.docker build
docker compose --env-file .env.docker up -d --force-recreate api worker
```

## Optional real FCM (not covered by mock smoke)

Keep a Firebase service account JSON file **outside the repository**. Set `FCM_SERVICE_ACCOUNT_PATH` in `.env.docker` to that **absolute host file path**, set `NOTIFICATION_PROVIDER=fcm`, then use both Compose files:

```bash
docker compose --env-file .env.docker -f compose.yaml -f compose.fcm.yaml config --quiet
docker compose --env-file .env.docker -f compose.yaml -f compose.fcm.yaml up -d --build api worker
```

The worker receives the JSON at `/run/secrets/sara_fcm_service_account` as a read-only Compose secret. Real FCM requires a device token, a correctly configured Firebase project, permissions, network egress and an on-device end-to-end test. A provider `ACCEPTED` response does not prove on-device delivery. **Never expose the Firebase private key to the API container.**

## Production checklist (not implemented by this PR)

- Use `NODE_ENV=production` with a real `https://...` `CORS_ALLOWED_ORIGINS`, distinct secrets, `NOTIFICATION_PROVIDER=fcm`, and the FCM Compose override (if push is enabled). `mock` is prohibited in production.
- Provide a TLS reverse proxy/ingress, secure host firewall, controlled API binding, trusted DNS, secure configuration/secret distribution, volume backups and tested restores. CORS **does not** replace JWT auth. The sample `127.0.0.1` bind intentionally prevents external access.
- Decide how Resend email OTP is sent: configure a verified domain and restrict environment access.
- Configure log collection/alerts and graceful shutdown in the next Reliability PR. Restart policies are not a substitute for observability.
- Do **not** use the embedded CI-only secrets or the example password fields in production.
- Schedule maintenance for migrations, ensure MySQL durable storage and test a full recovery.

## Troubleshooting

| Symptom | Check |
|---|---|
| Docker build fails in `yarn install` | Network to Yarn registry, Corepack Yarn 3.6.3, lockfile unchanged |
| MySQL is unhealthy | `docker compose ... logs mysql`; passwords, data volume initialization, available disk space |
| Migration exits nonzero | `docker compose ... logs migrate`; schema and checksum; do not delete schema_migrations |
| API stays unhealthy | `docker compose ... logs api`, `NODE_ENV`, CORS policy, JWT secret; check port 3000 |
| Worker restarts | `docker compose ... logs worker`; provider config, DB connectivity |
| HTTP 200 but database not usable | Health is liveness only; run the DB check command above |
| Real FCM not delivered | Check FCM service account mount and token, device permission and provider result; don't infer delivery from ACCEPTED |
