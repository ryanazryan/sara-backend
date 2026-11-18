import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p: string) => readFileSync(p, "utf8");

test("Docker packaging runs as non-root and excludes sensitive local files", () => {
  const dockerfile = read("Dockerfile");
  assert.match(dockerfile, /FROM node:24-bookworm-slim AS build/);
  assert.match(dockerfile, /yarn install --immutable/);
  assert.match(dockerfile, /COPY --chown=node:node database\/migrations/);
  assert.match(dockerfile, /USER node/);
  const ignored = read(".dockerignore");
  for (const entry of [".env.*", "node_modules", ".git", "tests"]) {
    assert.ok(ignored.split(/\r?\n/).includes(entry), `${entry} must be excluded from Docker context`);
  }
});

test("Compose isolates the DB, gates API on migrations and uses a single notification worker", () => {
  const compose = read("compose.yaml");
  assert.match(compose, /mysql_data:\/var\/lib\/mysql/);
  assert.match(compose, /service_completed_successfully/);
  assert.match(compose, /service_healthy/);
  assert.match(compose, /127\.0\.0\.1:\$\{SARA_API_PORT:-3000\}:3000/);
  assert.match(compose, /dist\/workers\/notification\.worker\.js/);
  assert.doesNotMatch(compose, /dist\/workers\/reminder\.worker\.js/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(read(".gitignore"), /!\.env\.docker\.example/);
  assert.match(read("compose.fcm.yaml"), /FCM_SERVICE_ACCOUNT_PATH/);
});
