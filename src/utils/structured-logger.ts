/**
 * Minimal JSON-lines operational logger. Only known-safe metadata is emitted.
 * Never pass request headers, bodies, URLs, SQL, tokens, or error.message.
 */
export type LogLevel = "info" | "warn" | "error";

const allowedKeys = [
  "requestId", "method", "route", "statusCode", "durationMs",
  "errorType", "signal", "port", "exitCode",
  "due", "expired", "queued", "accepted", "retried", "failed", "skipped",
] as const;

export function formatLog(
  level: LogLevel,
  event: string,
  attributes: Record<string, unknown> = {},
  now: Date = new Date(),
): string {
  // A fixed attribute allowlist prevents accidental token/password leakage.
  const safe: Record<string, string | number> = {};
  for (const key of allowedKeys) {
    const value = attributes[key];
    if (typeof value === "string") safe[key] = value.slice(0, 128);
    else if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
  }
  const safeEvent = /^[a-z][a-z0-9_.-]{0,79}$/.test(event) ? event : "unknown_event";
  return JSON.stringify({ timestamp: now.toISOString(), level, event: safeEvent, ...safe });
}

export function writeLog(level: LogLevel, event: string, attributes: Record<string, unknown> = {}): void {
  const line = `${formatLog(level, event, attributes)}\n`;
  if (level === "error") process.stderr.write(line);
  else process.stdout.write(line);
}
