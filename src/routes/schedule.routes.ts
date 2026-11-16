import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { listSchedule, listScheduleConflicts } from "../controllers/schedule-history.controller.js";

const router = Router();
router.use(requireAuth);
router.get("/", listSchedule);
router.get("/conflicts", listScheduleConflicts);
export default router;
