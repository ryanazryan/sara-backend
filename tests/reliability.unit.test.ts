import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLog } from "../src/utils/structured-logger.js";

test("structured logging emits stable JSON without tokens, headers or arbitrary data", () => {
  const output = formatLog("info", "http.completed", {
    requestId: "req-123", method: "POST", route: "/login", statusCode: 401,
    durationMs: 12, password: "super-secret", token: "jwt-here", Authorization: "Bearer secret",
    body: { email: "private@example.com" }, error: new Error("private stack"),
  }, new Date("2026-11-18T00:00:00.000Z"));
  const parsed = JSON.parse(output) as Record<string, unknown>;
  assert.equal(parsed.timestamp, "2026-11-18T00:00:00.000Z");
  assert.equal(parsed.event, "http.completed");
  assert.equal(parsed.statusCode, 401);
  assert.equal(parsed.durationMs, 12);
  for (const value of ["super-secret", "jwt-here", "Bearer secret", "private@example.com", "private stack"]) {
    assert.equal(output.includes(value), false);
  }
  assert.deepEqual(Object.keys(parsed), ["timestamp", "level", "event", "requestId", "method", "route", "statusCode", "durationMs"]);
});

test("untrusted event names are replaced, and unsupported metadata types are discarded", () => {
  const parsed = JSON.parse(formatLog("warn", "bad event name!", {
    requestId: { secret: "value" }, method: false, durationMs: Number.POSITIVE_INFINITY,
    errorType: "bad".repeat(100),
  })) as Record<string, unknown>;
  assert.equal(parsed.event, "unknown_event");
  assert.equal("requestId" in parsed, false);
  assert.equal("method" in parsed, false);
  assert.equal("durationMs" in parsed, false);
  assert.equal(typeof parsed.errorType, "string");
  assert.equal((parsed.errorType as string).length, 128);
});
