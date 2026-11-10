import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseRegister,
  parseVerification,
  EMAIL_REGEX,
  PASSWORD_REGEX,
} from "../src/validators/auth.validators.js";
import {
  hashPassword,
  verifyPassword,
  createOtp,
  otpDigest,
  otpMatches,
} from "../src/services/auth.service.js";

test("Week 9 email RegExp accepts valid addresses", () => {
  assert.equal(EMAIL_REGEX.test("ryan@example.com"), true);
  assert.equal(EMAIL_REGEX.test("ryanexample.com"), false);
});

test("Week 9 password RegExp requires letters, digits and length", () => {
  assert.equal(PASSWORD_REGEX.test("SARA12345"), true);
  assert.equal(PASSWORD_REGEX.test("12345678"), false);
  assert.equal(PASSWORD_REGEX.test("Short1"), false);
});

test("Register validates and normalizes email", () => {
  const result = parseRegister({
    fullName: "  Ryan  ",
    email: " RYAN@EXAMPLE.COM ",
    password: "SARA12345",
    confirmPassword: "SARA12345",
  });
  assert.equal(result.ok, true);
  if (result.ok)
    assert.deepEqual(result.data, {
      fullName: "Ryan",
      email: "ryan@example.com",
      password: "SARA12345",
    });
});

test("Register rejects nonmatching confirmation", () => {
  assert.equal(
    parseRegister({
      fullName: "Ryan",
      email: "ryan@example.com",
      password: "SARA12345",
      confirmPassword: "wrong",
    }).ok,
    false,
  );
});

test("OTP validation requires six numeric digits", () => {
  assert.equal(parseVerification({ email: "ryan@example.com", code: "123456" }).ok, true);
  assert.equal(parseVerification({ email: "ryan@example.com", code: "12ab56" }).ok, false);
});

test("Passwords are salted and verified", async () => {
  const stored = await hashPassword("SARA12345");
  assert.ok(!stored.includes("SARA12345"));
  assert.equal(await verifyPassword("SARA12345", stored), true);
  assert.equal(await verifyPassword("wrong-password", stored), false);
});

test("OTP is six digits and checked against HMAC", () => {
  process.env.OTP_PEPPER =
    process.env.OTP_PEPPER ?? "test-only-pepper-not-for-production-1234567890";
  const code = createOtp();
  assert.match(code, /^\d{6}$/);
  const digest = otpDigest(5, code);
  assert.equal(otpMatches(5, code, digest), true);
  assert.equal(otpMatches(6, code, digest), false);
});
