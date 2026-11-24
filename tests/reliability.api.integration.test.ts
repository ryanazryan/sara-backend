import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { AddressInfo } from "node:net";
import pool from "../src/config/database.js";
import app from "../src/app.js";

let poolClosed = false;
after(async () => { if (!poolClosed) await pool.end(); });

test("liveness stays public while readiness proves real test DB connectivity", async () => {
  // The QA runner only permits integration tests against the isolated test DB.
  assert.equal(process.env.DB_NAME, "sara_migration_test");
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      if (server.listening) return resolve();
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const live = await fetch(`${base}/api/health`);
    assert.equal(live.status, 200);
    const ready = await fetch(`${base}/api/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { success: true, status: "ready" });
    assert.match(ready.headers.get("x-request-id") ?? "", /^[\da-f-]{36}$/i);
    // Once MySQL is unavailable, readiness must fail closed (liveness still 200).
    await pool.end();
    poolClosed = true;
    const unavailable = await fetch(`${base}/api/ready`);
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { success: false, status: "not_ready" });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
  }
});
