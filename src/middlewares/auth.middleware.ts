import type { RequestHandler } from "express";
import { verifyAccessToken } from "../services/auth.service.js";

export const requireAuth: RequestHandler = async (req, res, next) => {
  const header = req.header("authorization") ?? "";
  const match = /^Bearer (\S+)$/i.exec(header);
  const userId = match ? await verifyAccessToken(match[1]) : null;
  if (!userId) {
    res.status(401).json({ success: false, message: "Missing or invalid access token" });
    return;
  }
  res.locals.authUserId = userId;
  next();
};
