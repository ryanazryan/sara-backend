import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { interpretIndonesianWithLLM, NlpProviderError } from "../src/services/nlp.service.js";

const reference = new Date("2026-11-18T05:00:00Z");
const zone = "Asia/Makassar";
const text = "Ingetin besok jam 2 siang rapat";
const valid = {
  isValidActivityIntent: true, namaAktivitas: "rapat", tanggal: "2026-11-19",
  jam: "14:00", reminderRequested: true, missingFields: [], issues: [],
};
function setup(t: TestContext, overrides: Record<string, string | undefined> = {}) {
  const values = { LLM_API_KEY: "fake-test-key", LLM_BASE_URL: undefined,
    LLM_MODEL: undefined, ...overrides };
  for (const [key, value] of Object.entries(values)) {
    const old = process.env[key];
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
function reply(t: TestContext, output: unknown) {
  return t.mock.method(globalThis, "fetch", async () => Response.json({
    choices: [{ message: { content: JSON.stringify(output) } }],
  }));
}

test("LLM preview converts local time to UTC and calls only Gemini", async (t) => {
  setup(t);
  const mock = t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer fake-test-key");
    return Response.json({ choices: [{ message: { content: JSON.stringify(valid) } }] });
  });
  const result = await interpretIndonesianWithLLM(text, zone, reference);
  assert.equal(result?.state, "READY");
  assert.equal(result?.structuredDraft.waktuMulai, "2026-11-19T06:00:00Z");
  assert.equal(result?.structuredDraft.reminderTriggerAt, "2026-11-19T06:00:00Z");
  assert.equal(mock.mock.callCount(), 1);
});

test("missing key uses deterministic parser without network", async (t) => {
  setup(t, { LLM_API_KEY: undefined });
  const mock = reply(t, valid);
  const result = await interpretIndonesianWithLLM("Buat aktivitas olahraga", zone, reference);
  assert.equal(result?.structuredDraft.namaAktivitas, "olahraga");
  assert.equal(mock.mock.callCount(), 0);
});

test("malformed output and unknown fields are rejected", async (t) => {
  setup(t);
  const cases = [null, { ...valid, reminderRequested: "false" },
    { ...valid, isValidActivityIntent: "true" }, { ...valid, jam: "25:00" },
    { ...valid, tanggal: "19/11/2026" }, { ...valid, missingFields: ["idPengguna"] },
    { ...valid, issues: "not an array" }, { ...valid, namaAktivitas: 123 },
    { ...valid, idPengguna: 1 }];
  let index = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ message: {
    content: JSON.stringify(cases[index++]),
  } }] }));
  for (const _ of cases) await assert.rejects(interpretIndonesianWithLLM(text, zone, reference), NlpProviderError);
});

test("invalid calendar date requires clarification", async (t) => {
  setup(t); reply(t, { ...valid, tanggal: "2026-11-31" });
  const result = await interpretIndonesianWithLLM(text, zone, reference);
  assert.equal(result?.state, "NEEDS_CLARIFICATION");
  assert.equal(result?.structuredDraft.waktuMulai, null);
});

test("past times and unresolved ambiguity cannot become scheduled drafts", async (t) => {
  setup(t); reply(t, { ...valid, tanggal: "2026-11-17" });
  const result = await interpretIndonesianWithLLM(text, zone, reference);
  assert.equal(result?.state, "NEEDS_CLARIFICATION");
  assert.equal(result?.structuredDraft.waktuMulai, null);
});

test("known ambiguous hour is not silently resolved by Gemini", async (t) => {
  setup(t); reply(t, valid);
  const result = await interpretIndonesianWithLLM("Ingatkan saya rapat besok jam 8", zone, reference);
  assert.equal(result?.state, "NEEDS_CLARIFICATION");
  assert.equal(result?.structuredDraft.waktuMulai, null);
});

test("unsupported intent produces no draft", async (t) => {
  setup(t); reply(t, { ...valid, isValidActivityIntent: false });
  assert.equal(await interpretIndonesianWithLLM("Halo SARA", zone, reference), null);
});

test("unapproved URL is rejected before making a request", async (t) => {
  setup(t, { LLM_BASE_URL: "https://example.invalid/v1" });
  const mock = reply(t, valid);
  await assert.rejects(interpretIndonesianWithLLM(text, zone, reference), NlpProviderError);
  assert.equal(mock.mock.callCount(), 0);
});

test("provider error does not leak upstream response or request contents", async (t) => {
  setup(t);
  t.mock.method(globalThis, "fetch", async () => new Response("sensitive upstream body", { status: 429 }));
  await assert.rejects(interpretIndonesianWithLLM(text, zone, reference), {
    name: "NlpProviderError", message: "LLM provider error: HTTP 429",
  });
});

test("invalid JSON yields a bounded provider error", async (t) => {
  setup(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ message: { content: "invalid json" } }] }));
  await assert.rejects(interpretIndonesianWithLLM(text, zone, reference), {
    name: "NlpProviderError", message: "Invalid LLM JSON",
  });
});
