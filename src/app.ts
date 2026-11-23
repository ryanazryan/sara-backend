import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import routes from "./routes/index.js";
import { parseCorsPolicy, isCorsOriginAllowed } from "./config/http-security.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import { writeLog } from "./utils/structured-logger.js";

const app = express();
const corsPolicy = parseCorsPolicy(process.env.CORS_ALLOWED_ORIGINS, process.env.NODE_ENV);
// Only trust X-Forwarded-* when behind a controlled reverse proxy.
const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? "0");
if (!Number.isSafeInteger(proxyHops) || proxyHops < 0 || proxyHops > 2) {
  throw new Error("TRUST_PROXY_HOPS must be an integer from 0 to 2");
}
app.set("trust proxy", proxyHops);

app.disable("x-powered-by");
app.use((req, res, next) => {
  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
  res.once("finish", () => {
    const route = typeof req.route?.path === "string" ? req.route.path : "unmatched";
    const elapsed = Number(process.hrtime.bigint() - startedAt) / 1e6;
    writeLog(res.statusCode >= 500 ? "error" : "info", "http.completed", {
      requestId, method: req.method, route, statusCode: res.statusCode,
      durationMs: Math.round(elapsed),
    });
  });
  next();
});
app.use(cors({
  origin(origin, callback) { callback(null, isCorsOriginAllowed(corsPolicy, origin)); },
  credentials: false,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  maxAge: 600,
}));
// Do not allocate or parse arbitrarily large attacker-controlled JSON bodies.
app.use(express.json({ limit: "64kb", strict: true }));

app.use(routes);

app.use(errorHandler);

export default app;
