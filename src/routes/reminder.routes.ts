import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { cancelReminder, listReminders, readReminder, updateReminder } from "../controllers/reminder.controller.js";

const router = Router();
router.use(requireAuth);
router.get("/", listReminders);
router.get("/:id", readReminder);
router.patch("/:id", updateReminder);
router.delete("/:id", cancelReminder);
export default router;
