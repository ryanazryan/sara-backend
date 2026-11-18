import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import app from "../src/app.js";

test("API sends secure headers, safe JSON parse errors, body-size errors, and protects auth routes", async () => {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      if (server.listening) return resolve();
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const healthy = await fetch(`${base}/api/health`, { headers: { Origin: "http://localhost:8081" } });
    assert.equal(healthy.status, 200);
    assert.equal(healthy.headers.get("x-content-type-options"), "nosniff");
    assert.equal(healthy.headers.get("cache-control"), "no-store");
    assert.equal(healthy.headers.get("x-frame-options"), "DENY");
    assert.equal(healthy.headers.get("x-powered-by"), null);
    assert.match(healthy.headers.get("x-request-id") ?? "", /^[a-f\d-]{36}$/i);
    assert.deepEqual(await healthy.json(), { success: true, message: "SARA Backend is running" });

    const unauth = await fetch(`${base}/api/assistant/priorities`);
    assert.equal(unauth.status, 401);
    assert.equal((await unauth.json() as { success: boolean }).success, false);

    const malformed = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{broken-json",
    });
    assert.equal(malformed.status, 400);
    const invalid = await malformed.json() as { success: boolean; message: string; requestId: string };
    assert.equal(invalid.message, "Malformed JSON request body");
    assert.equal(invalid.requestId, malformed.headers.get("x-request-id"));

    const oversized = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "x".repeat(70 * 1024) }),
    });
    assert.equal(oversized.status, 413);
    const tooLarge = await oversized.json() as { message: string };
    assert.equal(tooLarge.message, "JSON body exceeds 64kb limit");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => error ? reject(error) : resolve());
    });
  }
});
