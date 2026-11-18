import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import routes from "./routes/index.js";
import { parseCorsPolicy, isCorsOriginAllowed } from "./config/http-security.js";
import { errorHandler } from "./middlewares/error.middleware.js";

const app = express();
const corsPolicy = parseCorsPolicy(process.env.CORS_ALLOWED_ORIGINS, process.env.NODE_ENV);

app.disable("x-powered-by");
app.use((_req, res, next) => {
  const requestId = randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
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
