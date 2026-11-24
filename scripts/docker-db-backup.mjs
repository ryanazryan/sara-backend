#!/usr/bin/env node
/**
 * Dump the Docker MySQL database to a private, uniquely named local file.
 * Credentials stay inside the mysql container (never passed on the host CLI).
 * This is an operator-invoked backup; scheduling, offsite storage and restore
 * testing remain operator responsibilities.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";

if (process.argv.length > 3) {
  console.error("Usage: node scripts/docker-db-backup.mjs [backup-directory]");
  process.exit(2);
}
const root = path.resolve(import.meta.dirname, "..");
const dir = path.resolve(root, process.argv[2] ?? "backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupFile = path.join(dir, `sara-${stamp}-${randomBytes(3).toString("hex")}.sql`);
await mkdir(dir, { recursive: true, mode: 0o700 });

const mysqlScript = [
  'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD";',
  'exec mysqldump -u root --default-character-set=utf8mb4',
  '--single-transaction --quick --routines --triggers --events',
  '--no-tablespaces --set-gtid-purged=OFF "$MYSQL_DATABASE"',
].join(" ");
const child = spawn(process.platform === "win32" ? "docker.exe" : "docker", [
  "compose", "--env-file", ".env.docker", "exec", "-T", "mysql", "sh", "-c", mysqlScript,
], { cwd: root, stdio: ["ignore", "pipe", "inherit"], shell: false });

try {
  await Promise.all([
    pipeline(child.stdout, createWriteStream(backupFile, { flags: "wx", mode: 0o600 })),
    new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`mysqldump exit code ${code}`)));
    }),
  ]);
  const { size } = await stat(backupFile);
  if (size === 0) throw new Error("Backup file is empty");
  console.log(`Backup complete: ${backupFile} (${size} bytes)`);
} catch (error) {
  await rm(backupFile, { force: true });
  console.error("Backup FAILED; incomplete dump removed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
}
