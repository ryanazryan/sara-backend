import { Router } from "express";
import healthRoutes from "./health.routes.js";
import authRoutes from "./auth.routes.js";
import kegiatanRoutes from "./kegiatan.routes.js";
import aktivitasRoutes from "./aktivitas.routes.js";
import scheduleRoutes from "./schedule.routes.js";
import historyRoutes from "./history.routes.js";
import reminderRoutes from "./reminder.routes.js";

const router = Router();

router.use("/api", healthRoutes);
router.use("/api/auth", authRoutes);
router.use("/api/kegiatan", kegiatanRoutes);
router.use("/api/aktivitas", aktivitasRoutes);
router.use("/api/schedule", scheduleRoutes);
router.use("/api/history", historyRoutes);
router.use("/api/reminders", reminderRoutes);

export default router;
