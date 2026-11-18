#!/usr/bin/env node
/** Minimal container HTTP smoke check; no real user data or tokens needed. */
const base = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
let url;
try { url = new URL(base); } catch { console.error("Expected absolute http(s) base URL"); process.exit(2); }
if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
  console.error("Smoke URL must be HTTP(S) without embedded credentials");
  process.exit(2);
}
async function request(path) {
  const response = await fetch(new URL(path, `${url.origin}/`), { signal: AbortSignal.timeout(8000) });
  let payload;
  try { payload = await response.json(); } catch { throw new Error(`${path}: response is not JSON`); }
  return { status: response.status, payload };
}
try {
  const live = await request("/api/health");
  if (live.status !== 200 || live.payload?.success !== true) throw new Error(`health: ${live.status}`);
  const protectedRoute = await request("/api/auth/me");
  if (protectedRoute.status !== 401 || protectedRoute.payload?.success !== false) {
    throw new Error(`auth boundary: expected 401, received ${protectedRoute.status}`);
  }
  console.log("PASS Docker smoke: /api/health 200; /api/auth/me 401 without JWT");
} catch (error) {
  console.error("FAIL Docker smoke:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
