import type { ErrorRequestHandler } from "express";
import { writeLog } from "../utils/structured-logger.js";

type BodyParserError = { type?: unknown };

export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  if (res.headersSent) { next(err); return; }
  const failure = (err && typeof err === "object") ? err as BodyParserError : {};
  const requestId = res.locals.requestId as string | undefined;
  if (failure.type === "entity.parse.failed") {
    res.status(400).json({ success: false, message: "Malformed JSON request body", requestId });
    return;
  }
  if (failure.type === "entity.too.large") {
    res.status(413).json({ success: false, message: "JSON body exceeds 64kb limit", requestId });
    return;
  }
  if (failure.type === "encoding.unsupported" || failure.type === "charset.unsupported") {
    res.status(415).json({ success: false, message: "Unsupported request encoding", requestId });
    return;
  }
  // Never log raw error details: MySQL/HTTP errors may include private data.
  writeLog("error", "http.unhandled_error", {
    requestId, errorType: err instanceof Error ? err.name : "UnknownError",
  });
  res.status(500).json({ success: false, message: "Internal Server Error", requestId });
};
