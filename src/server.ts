import "dotenv/config";
import app from "./app.js";
import pool from "./config/database.js";
import { assertProductionSecurityConfig } from "./config/http-security.js";
import { writeLog } from "./utils/structured-logger.js";

assertProductionSecurityConfig(process.env);
const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, () => {
  writeLog("info", "server.started", { port: PORT });
});

let stopping = false;
const SHUTDOWN_TIMEOUT_MS = 15_000;
async function shutdown(signal: "SIGTERM" | "SIGINT"): Promise<void> {
  if (stopping) return;
  stopping = true;
  writeLog("info", "server.shutdown_start", { signal });
  const deadline = setTimeout(() => {
    writeLog("error", "server.shutdown_timeout", { signal });
    server.closeAllConnections();
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  try {
    // Stop accepting new HTTP requests, drain active connections, close MySQL pool.
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => error ? reject(error) : resolve());
      server.closeIdleConnections();
    });
    await pool.end();
    writeLog("info", "server.shutdown_complete", { signal });
  } catch (error) {
    writeLog("error", "server.shutdown_failed", {
      signal, errorType: error instanceof Error ? error.name : "UnknownError",
    });
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
  }
}

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });
