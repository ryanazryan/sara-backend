import { Router } from "express";
import healthRoutes from "./health.routes.js";
import authRoutes from "./auth.routes.js";
import kegiatanRoutes from "./kegiatan.routes.js";
import aktivitasRoutes from "./aktivitas.routes.js";

const router = Router();

router.use("/api", healthRoutes);
router.use("/api/auth", authRoutes);
router.use("/api/kegiatan", kegiatanRoutes);
router.use("/api/aktivitas", aktivitasRoutes);

export default router;
