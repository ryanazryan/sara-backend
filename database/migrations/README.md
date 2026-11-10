# SARA database migrations

This folder contains **versioned MySQL 8 SQL migrations**. Domain migrations are not
included yet: the team must first resolve the open identity, Activity lifecycle,
ID type, and ORM/migration choices recorded in the SARA Decision & Change Log.

## Commands

From the repository root, with `.env` set and MySQL running:

- `yarn db:migrate:status` — read-only migration status (does not create a table).
- `yarn db:migrate` — creates the `schema_migrations` tracking table and applies new files.
- `yarn test:db-migrations` — unit tests for filename, SQL and checksum guards.

Migrations are named `0001_description.sql`, `0002_description.sql`, etc.
**Each file must have exactly one SQL statement**; splitting DDL into separate
files makes failures easier to inspect. `--` whole-line comments are supported.
Migrations use checksum verification and cannot be edited after application.

MySQL DDL implicitly commits, so a migration cannot be atomically committed with
its history record. A failed or interrupted migration remains `running`; the
runner refuses to retry it automatically. Inspect both the schema and history
before manually resolving an interrupted migration. Do not delete or rewrite
history rows to bypass the safety check. Never run these commands against
production without an approved backup and deployment procedure.

The runner uses the existing `src/config/database.ts` pool, reads SQL files from
`database/migrations` relative to the project root, and uses a MySQL advisory
lock to prevent two runners from applying changes at the same time.
