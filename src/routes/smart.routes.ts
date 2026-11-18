import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {
  confirmSmartSuggestion, createSmartSuggestions, listActivityPriorities, readSmartSuggestion,
} from "../controllers/smart.controller.js";

const router = Router();
router.use(requireAuth);
const suggestLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true,
  legacyHeaders: false, message: { success: false, message: "Too many assistance requests" } });
router.post("/suggestions", suggestLimiter, createSmartSuggestions);
router.get("/suggestions/:id", readSmartSuggestion);
router.post("/suggestions/:id/confirm", suggestLimiter, confirmSmartSuggestion);
router.get("/priorities", listActivityPriorities);
export default router;
