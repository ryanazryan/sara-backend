import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { login, me, register, resendOtp, verifyEmail } from "../controllers/auth.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Try again later." },
});

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.post("/verify-email", authLimiter, verifyEmail);
router.post("/resend-otp", authLimiter, resendOtp);
router.get("/me", requireAuth, me);

export default router;
