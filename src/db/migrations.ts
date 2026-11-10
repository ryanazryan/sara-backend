import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type MigrationFile = {
  id: string;
  checksum: string;
  sql: string;
};

export type MigrationRecord = {
  migration_id: string;
  checksum: string;
  state: "running" | "applied";
};

// File migrations are deliberately restricted to ONE statement each.
// MySQL DDL auto-commits; a failed/interrupted migration is never replayed silently.
export function parseMigration(filename: string, content: string): MigrationFile {
  if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(filename)) {
    throw new Error(`Invalid migration filename: ${filename}`);
  }

  const normalized = content.replace(/\r\n?/g, "\n").trimEnd() + "\n";
  const sql = normalized
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n")
    .trim();
  const statement = sql.endsWith(";") ? sql.slice(0, -1).trimEnd() : sql;

  if (!statement || statement.includes(";")) {
    throw new Error(`Migration ${filename} must contain exactly one SQL statement`);
  }

  return {
    id: filename.slice(0, -4),
    checksum: createHash("sha256").update(normalized).digest("hex"),
    sql: statement,
  };
}

export async function loadMigrations(directory: string): Promise<MigrationFile[]> {
  const filenames = (await readdir(directory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  return Promise.all(
    filenames.map(async (filename) => {
      const content = await readFile(path.join(directory, filename), "utf8");
      return parseMigration(filename, content);
    }),
  );
}

export function pendingMigrations(
  files: MigrationFile[],
  records: MigrationRecord[],
): MigrationFile[] {
  const source = new Map(files.map((file) => [file.id, file]));
  const history = new Map<string, MigrationRecord>();

  for (const record of records) {
    if (history.has(record.migration_id)) {
      throw new Error(`Duplicate migration history: ${record.migration_id}`);
    }
    history.set(record.migration_id, record);

    const file = source.get(record.migration_id);
    if (!file) {
      throw new Error(`Applied migration file is missing: ${record.migration_id}`);
    }
    if (record.checksum !== file.checksum) {
      throw new Error(`Migration checksum changed: ${record.migration_id}`);
    }
    if (record.state !== "applied") {
      throw new Error(
        `Migration ${record.migration_id} is unfinished; inspect the database before recovery`,
      );
    }
  }

  return files.filter((file) => !history.has(file.id));
}

export const DEFAULT_MIGRATIONS_DIR = path.resolve(process.cwd(), "database", "migrations");
