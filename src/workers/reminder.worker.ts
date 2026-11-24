import "dotenv/config";
import pool from "../config/database.js";
import { writeLog } from "../utils/structured-logger.js";
import { processDueReminders } from "../services/reminder.service.js";

const mode = process.argv[2] ?? "once";
const pollMs = Number(process.env.REMINDER_POLL_MS ?? "10000");
if (mode !== "once" && mode !== "loop") throw new Error("Usage: reminders:run or reminders:worker");
if (!Number.isSafeInteger(pollMs) || pollMs < 1000 || pollMs > 60000) {
  throw new Error("REMINDER_POLL_MS must be between 1000 and 60000");
}
let running = true;
process.on("SIGINT", () => { running = false; });
process.on("SIGTERM", () => { running = false; });

async function run(): Promise<void> {
  try {
    do {
      const result = await processDueReminders();
      writeLog("info", "worker.reminder_tick", { due: result.due, expired: result.expired });
      if (mode === "once" || !running) break;
      await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
    } while (running);
  } finally {
    await pool.end();
  }
}
run().catch((error: unknown) => {
  writeLog("error", "worker.reminder_failed", {
    errorType: error instanceof Error ? error.name : "UnknownError",
  });
  process.exitCode = 1;
});
