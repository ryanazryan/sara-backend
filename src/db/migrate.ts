import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import pool from "../config/database.js";
import {
  DEFAULT_MIGRATIONS_DIR,
  loadMigrations,
  pendingMigrations,
  type MigrationRecord,
} from "./migrations.js";

type RecordRow = RowDataPacket & MigrationRecord;
type DatabaseRow = RowDataPacket & { db: string | null };
type LockRow = RowDataPacket & { acquired: number | null };

async function databaseName(connection: PoolConnection): Promise<string> {
  const [rows] = await connection.query<DatabaseRow[]>("SELECT DATABASE() AS db");
  if (!rows[0]?.db) {
    throw new Error("DB_NAME is not selected; check the local .env configuration");
  }
  return rows[0].db;
}

async function tableExists(connection: PoolConnection): Promise<boolean> {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'schema_migrations' LIMIT 1",
  );
  return rows.length > 0;
}

async function readHistory(connection: PoolConnection): Promise<MigrationRecord[]> {
  if (!(await tableExists(connection))) return [];
  const [rows] = await connection.query<RecordRow[]>(
    "SELECT migration_id, checksum, state FROM schema_migrations ORDER BY migration_id",
  );
  return rows;
}

async function ensureHistoryTable(connection: PoolConnection): Promise<void> {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_id VARCHAR(191) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      state VARCHAR(16) NOT NULL,
      started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      applied_at DATETIME(6) NULL,
      CONSTRAINT chk_schema_migrations_state CHECK (state IN ('running', 'applied'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function run(): Promise<void> {
  const command = process.argv[2];
  if (command !== "up" && command !== "status") {
    throw new Error("Usage: yarn db:migrate or yarn db:migrate:status");
  }

  const files = await loadMigrations(DEFAULT_MIGRATIONS_DIR);
  const connection = await pool.getConnection();
  let lockName: string | undefined;

  try {
    const name = await databaseName(connection);
    if (command === "up") {
      lockName = `sara_migrate_${createHash("sha256").update(name).digest("hex").slice(0, 20)}`;
      const [locks] = await connection.query<LockRow[]>("SELECT GET_LOCK(?, 15) AS acquired", [
        lockName,
      ]);
      if (locks[0]?.acquired !== 1) {
        throw new Error("Another database migration is running (lock timeout)");
      }
      await ensureHistoryTable(connection);
    }

    const pending = pendingMigrations(files, await readHistory(connection));
    if (command === "status") {
      console.log(
        `Database: ${name}; migration files: ${files.length}; pending: ${pending.length}`,
      );
      for (const file of pending) console.log(`PENDING ${file.id}`);
      return;
    }

    for (const file of pending) {
      // MySQL DDL cannot be made atomic together with the history update.
      // Persist "running" first so an interruption requires manual review.
      await connection.execute(
        "INSERT INTO schema_migrations (migration_id, checksum, state) VALUES (?, ?, 'running')",
        [file.id, file.checksum],
      );
      await connection.query(file.sql);
      await connection.execute(
        "UPDATE schema_migrations SET state = 'applied', applied_at = UTC_TIMESTAMP(6) WHERE migration_id = ? AND state = 'running'",
        [file.id],
      );
      console.log(`APPLIED ${file.id}`);
    }
    console.log(`Migration check complete: ${pending.length} applied, ${files.length} total`);
  } finally {
    try {
      if (lockName) {
        await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
      }
    } finally {
      connection.release();
    }
  }
}

run()
  .catch((error: unknown) => {
    console.error("Database migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
