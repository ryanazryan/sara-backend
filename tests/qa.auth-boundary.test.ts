import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import app from "../src/app.js";

// Representative requests cover every authenticated router and method. The
// separate qa:contract check enforces route inventory coverage.
const protectedRequests: ReadonlyArray<readonly [string, string]> = [
  ["GET", "/api/auth/me"],
  ["GET", "/api/kegiatan"],
  ["POST", "/api/kegiatan"],
  ["GET", "/api/kegiatan/1"],
  ["PATCH", "/api/kegiatan/1"],
  ["DELETE", "/api/kegiatan/1"],
  ["GET", "/api/aktivitas"],
  ["POST", "/api/aktivitas"],
  ["GET", "/api/aktivitas/1"],
  ["PATCH", "/api/aktivitas/1"],
  ["DELETE", "/api/aktivitas/1"],
  ["POST", "/api/aktivitas/1/status"],
  ["GET", "/api/aktivitas/1/history"],
  ["GET", "/api/aktivitas/1/reminders"],
  ["POST", "/api/aktivitas/1/reminders"],
  ["GET", "/api/schedule"],
  ["GET", "/api/schedule/conflicts"],
  ["GET", "/api/history"],
  ["GET", "/api/reminders"],
  ["GET", "/api/reminders/1"],
  ["PATCH", "/api/reminders/1"],
  ["DELETE", "/api/reminders/1"],
  ["GET", "/api/devices"],
  ["POST", "/api/devices"],
  ["PATCH", "/api/devices/1"],
  ["DELETE", "/api/devices/1"],
  ["GET", "/api/notifications"],
  ["POST", "/api/ai/parse"],
  ["GET", "/api/ai/interpretations/00000000-0000-4000-8000-000000000001"],
  ["POST", "/api/ai/interpretations/00000000-0000-4000-8000-000000000001/confirm"],
  ["POST", "/api/assistant/suggestions"],
  ["GET", "/api/assistant/suggestions/00000000-0000-4000-8000-000000000001"],
  ["POST", "/api/assistant/suggestions/00000000-0000-4000-8000-000000000001/confirm"],
  ["GET", "/api/assistant/priorities"],
];

test("all protected API route methods reject absent and invalid JWT before accessing data", async () => {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      if (server.listening) return resolve();
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200, "health endpoint remains public");
    for (const [method, path] of protectedRequests) {
      for (const token of [null, "not-a-jwt"]) {
        const response = await fetch(`${base}${path}`, {
          method,
          headers: token ? { authorization: `Bearer ${token}` } : {},
        });
        assert.equal(response.status, 401, `${method} ${path} with ${token ? "invalid" : "missing"} JWT`);
        const body = (await response.json()) as { success: boolean; message?: string };
        assert.equal(body.success, false);
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err?: Error) => err ? reject(err) : resolve());
    });
  }
});
