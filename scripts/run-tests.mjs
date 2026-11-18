#!/usr/bin/env node
/**
 * SARA QA runner: one fresh process per test file. Several MySQL integration
 * tests call pool.end(), so a single Node --test invocation is NOT safe.
 * Run DB migrations separately before integration tests.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const mode = process.argv[2];
if (!["--unit", "--integration", "--all", "--list"].includes(mode) || process.argv.length !== 3) {
  console.error("Usage: node scripts/run-tests.mjs --unit | --integration | --all | --list");
  process.exit(2);
}
const root = path.resolve(import.meta.dirname, "..");
const names = readdirSync(path.join(root, "tests"))
  .filter((name) => /^[a-z0-9][a-z0-9.-]*\.test\.ts$/.test(name)).sort();
const unit = names.filter((name) => !name.endsWith(".integration.test.ts"));
const integration = names.filter((name) => name.endsWith(".integration.test.ts"));

if (unit.length === 0 || integration.length === 0) {
  console.error("Refusing to pass an empty test suite (check tests filenames).");
  process.exit(2);
}
if (mode === "--list") {
  console.log(`Unit (${unit.length}):\n${unit.join("\n")}\nIntegration (${integration.length}):\n${integration.join("\n")}`);
  process.exit(0);
}
if (mode !== "--unit" && process.env.DB_NAME !== "sara_migration_test") {
  console.error("REFUSING INTEGRATION TESTS: DB_NAME must be sara_migration_test. Tests insert/delete records.");
  process.exit(2);
}
const selected = mode === "--unit" ? unit : mode === "--integration" ? integration : [...unit, ...integration];
console.log(`SARA QA: ${selected.length} files, executed sequentially in separate processes.`);
let passed = 0;
for (const name of selected) {
  const file = `tests/${name}`;
  console.log(`\n[${passed + 1}/${selected.length}] ${file}`);
  // Run Node directly instead of invoking yarn.cmd through a shell on Windows.
  // The tsx import hook handles TypeScript on both Node.js 22 and 24.
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", file], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
  if (result.error || result.status !== 0) {
    console.error(`\nFAILED: ${file} (${result.error?.message ?? `exit ${String(result.status)}`}). Stopping.`);
    process.exit(result.status && result.status > 0 ? result.status : 1);
  }
  passed++;
}
console.log(`\nPASS: ${passed}/${selected.length} test files.`);
