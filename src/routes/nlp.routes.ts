import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { parseNaturalLanguage, readInterpretation, confirmInterpretation } from "../controllers/nlp.controller.js";

const router = Router();
router.use(requireAuth);
const parseLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: "Too many NLP requests. Try again later." } });
router.post("/parse", parseLimiter, parseNaturalLanguage);
router.get("/interpretations/:id", readInterpretation);
router.post("/interpretations/:id/confirm", confirmInterpretation);
export default router;
