import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMigration, pendingMigrations } from "../src/db/migrations.js";

const first = parseMigration(
  "0001_example.sql",
  "-- One DDL statement only\nCREATE TABLE example (id INT PRIMARY KEY);\n",
);

test("parses a single SQL statement and normalizes Windows line endings", () => {
  const windows = parseMigration(
    "0001_example.sql",
    "-- One DDL statement only\r\nCREATE TABLE example (id INT PRIMARY KEY);\r\n",
  );
  assert.equal(windows.checksum, first.checksum);
  assert.equal(first.sql, "CREATE TABLE example (id INT PRIMARY KEY)");
});

test("rejects multiple SQL statements", () => {
  assert.throws(
    () => parseMigration("0002_bad.sql", "CREATE TABLE a (id INT); DROP TABLE a;"),
    /exactly one SQL statement/,
  );
});

test("rejects incorrectly named or empty migration", () => {
  assert.throws(() => parseMigration("migration.sql", "SELECT 1;"), /filename/);
  assert.throws(() => parseMigration("0003_empty.sql", "-- no statement\n"), /exactly one/);
});

test("pending migrations excludes applied records", () => {
  assert.deepEqual(pendingMigrations([first], []), [first]);
  assert.deepEqual(
    pendingMigrations(
      [first],
      [{ migration_id: first.id, checksum: first.checksum, state: "applied" }],
    ),
    [],
  );
});

test("rejects edited migration or missing source file", () => {
  assert.throws(
    () =>
      pendingMigrations(
        [first],
        [{ migration_id: first.id, checksum: "0".repeat(64), state: "applied" }],
      ),
    /checksum changed/,
  );
  assert.throws(
    () =>
      pendingMigrations(
        [],
        [{ migration_id: first.id, checksum: first.checksum, state: "applied" }],
      ),
    /file is missing/,
  );
});

test("rejects an unfinished migration rather than replaying it", () => {
  assert.throws(
    () =>
      pendingMigrations(
        [first],
        [{ migration_id: first.id, checksum: first.checksum, state: "running" }],
      ),
    /unfinished/,
  );
});
