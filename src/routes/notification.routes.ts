import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { listNotifications } from "../controllers/notification.controller.js";
const router = Router();
router.use(requireAuth);
router.get("/", listNotifications);
export default router;
