import { Router } from "express";
import { createReminder, listActivityReminders } from "../controllers/reminder.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { historyByActivity, setAktivitasStatus } from "../controllers/schedule-history.controller.js";
import {
  createAktivitas,
  deleteAktivitas,
  listAktivitas,
  readAktivitas,
  updateAktivitas,
} from "../controllers/aktivitas.controller.js";

const router = Router();
router.use(requireAuth);
router.get("/", listAktivitas);
router.post("/", createAktivitas);
router.get("/:id/history", historyByActivity);
router.get("/:id/reminders", listActivityReminders);
router.post("/:id/reminders", createReminder);
router.post("/:id/status", setAktivitasStatus);
router.get("/:id", readAktivitas);
router.patch("/:id", updateAktivitas);
router.delete("/:id", deleteAktivitas);
export default router;
