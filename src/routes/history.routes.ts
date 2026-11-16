import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { listHistory } from "../controllers/schedule-history.controller.js";

const router = Router();
router.use(requireAuth);
router.get("/", listHistory);
export default router;
