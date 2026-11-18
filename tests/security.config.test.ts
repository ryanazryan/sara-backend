import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertProductionSecurityConfig, isCorsOriginAllowed, parseCorsPolicy,
} from "../src/config/http-security.js";

test("development CORS is permissive by default; production fails closed", () => {
  const local = parseCorsPolicy(undefined, "development");
  assert.equal(local.wildcard, true);
  assert.equal(isCorsOriginAllowed(local, "http://localhost:8081"), true);
  assert.throws(() => parseCorsPolicy(undefined, "production"), /CORS_ALLOWED_ORIGINS/);
  assert.throws(() => parseCorsPolicy("*", "production"), /Invalid CORS/);
  assert.throws(() => parseCorsPolicy("http://example.com", "production"), /HTTPS/);
  assert.throws(() => parseCorsPolicy("https://example.com/path", "production"), /origins/);
  assert.throws(() => parseCorsPolicy("https://user:pw@example.com", "production"), /origins/);
});

test("allowlist matches exact origins and permits native requests with no Origin", () => {
  const policy = parseCorsPolicy("https://sara.example,https://dashboard.example/", "production");
  assert.deepEqual(policy.origins, ["https://sara.example", "https://dashboard.example"]);
  assert.equal(isCorsOriginAllowed(policy, "https://sara.example"), true);
  assert.equal(isCorsOriginAllowed(policy, "https://evil.example"), false);
  assert.equal(isCorsOriginAllowed(policy, "null"), false);
  assert.equal(isCorsOriginAllowed(policy, undefined), true);
});

test("production secrets must be strong and independent", () => {
  const good = { NODE_ENV: "production", CORS_ALLOWED_ORIGINS: "https://sara.example",
    JWT_SECRET: "j".repeat(40), OTP_PEPPER: "p".repeat(40) } as NodeJS.ProcessEnv;
  assert.doesNotThrow(() => assertProductionSecurityConfig(good));
  assert.throws(() => assertProductionSecurityConfig({ ...good, JWT_SECRET: "short" }), /JWT_SECRET/);
  assert.throws(() => assertProductionSecurityConfig({ ...good, OTP_PEPPER: good.JWT_SECRET }), /must differ/);
  assert.throws(() => assertProductionSecurityConfig({ ...good, CORS_ALLOWED_ORIGINS: "" }), /CORS_ALLOWED_ORIGINS/);
});
