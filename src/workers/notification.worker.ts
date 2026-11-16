import "dotenv/config";
import pool from "../config/database.js";
import { dispatchNotifications } from "../services/notification.service.js";

const mode = process.argv[2] ?? "once";
if (mode !== "once" && mode !== "loop") throw new Error("Usage: notifications:run or notifications:worker");
const pollMs = Number(process.env.NOTIFICATION_POLL_MS ?? "10000");
if (!Number.isSafeInteger(pollMs) || pollMs < 1000 || pollMs > 60000)
  throw new Error("NOTIFICATION_POLL_MS must be between 1000 and 60000");
let running = true;
process.on("SIGINT", () => { running = false; });
process.on("SIGTERM", () => { running = false; });

async function main(): Promise<void> {
  try {
    do {
      const summary = await dispatchNotifications();
      console.log("Notification worker summary:", JSON.stringify(summary));
      if (mode === "once" || !running) break;
      await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
    } while (running);
  } finally { await pool.end(); }
}
main().catch((error: unknown) => {
  console.error("Notification worker failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
