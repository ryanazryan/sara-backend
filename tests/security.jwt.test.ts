import assert from "node:assert/strict";
import { test } from "node:test";
import { SignJWT } from "jose";
import { issueAccessToken, verifyAccessToken } from "../src/services/auth.service.js";

test("JWT requires canonical unsigned-int subject and seven-day issue/expiry claims", async () => {
  const previous = process.env.JWT_SECRET;
  const key = process.env.JWT_SECRET ?? "test-only-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
  process.env.JWT_SECRET = key;
  try {
    assert.equal(await verifyAccessToken(await issueAccessToken(42)), 42);
    await assert.rejects(issueAccessToken(0), /Invalid user ID/);
    await assert.rejects(issueAccessToken(4_294_967_296), /Invalid user ID/);
    const secret = new TextEncoder().encode(key);
    const now = Math.floor(Date.now() / 1000);
    const make = (sub: string, iat?: number, exp?: number, typ = "JWT") => {
      const data = new SignJWT({}).setProtectedHeader({ alg: "HS256", typ }).setSubject(sub);
      if (iat !== undefined) data.setIssuedAt(iat);
      if (exp !== undefined) data.setExpirationTime(exp);
      return data.sign(secret);
    };
    assert.equal(await verifyAccessToken(await make("01", now, now + 300)), null);
    assert.equal(await verifyAccessToken(await make("4294967296", now, now + 300)), null);
    assert.equal(await verifyAccessToken(await make("10", undefined, now + 300)), null);
    assert.equal(await verifyAccessToken(await make("10", now, undefined)), null);
    assert.equal(await verifyAccessToken(await make("10", now, now + 10 * 86400)), null);
    assert.equal(await verifyAccessToken(await make("10", now + 600, now + 900)), null);
    assert.equal(await verifyAccessToken(await make("10", now, now + 300, "other")), null);
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  }
});
