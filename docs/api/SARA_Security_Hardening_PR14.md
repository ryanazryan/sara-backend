# SARA Backend — Security Hardening (PR #14, Slice 1)

This change is **HTTP/API security hardening**, not a complete security audit or production-readiness certification.

## Controls

- **CORS allowlist:** `CORS_ALLOWED_ORIGINS` is an optional comma-separated list of exact HTTP(S) origins in development; when unset in development, legacy permissive CORS behavior remains. In **production** it is required and entries must be HTTPS. Origins are matched exactly. Requests with no `Origin` header (mobile native clients, Postman, internal calls) remain accepted; CORS is not authentication or an SSRF defense.
- **Security response headers:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cache-Control: no-store`; remove `X-Powered-By`. API responses include `X-Request-ID` for troubleshooting.
- **JSON body limit:** 64 KiB. Malformed JSON returns 400, oversized JSON returns 413, unsupported charset/encoding 415; error responses have a request ID. Clients should handle these distinct from domain-level 422 validation errors.
- **Safe exception logging:** unhandled errors are logged using their type and generated request ID, never the raw error object or stack, which may include SQL values or secrets. For detailed diagnostics, secure telemetry with redaction should be configured separately.
- **JWT validation:** reject missing `sub`, `iat`, `exp`, non-canonical/out-of-range subject, future-issued tokens, expiration before issuance, token lifetime beyond ~7 days, or unexpected `typ`. Tokens issued by existing `/api/auth/login` remain compatible.
- **NLP confirmation rate limiting:** `/api/ai/parse` and `/api/ai/interpretations/:id/confirm` now share the existing 30 requests per 15 minutes **per client IP** budget. Smart Assistance suggestion and confirmation routes already share their own limiter; this PR does not duplicate it.
- **Startup fail-closed:** in production, missing/invalid allowlist, short secrets, or identical `JWT_SECRET` and `OTP_PEPPER` prevent startup.

## Production environment

```dotenv
NODE_ENV=production
CORS_ALLOWED_ORIGINS=https://app.example.com,https://dashboard.example.com
JWT_SECRET=<strong-independent-secret-at-least-32-bytes>
OTP_PEPPER=<different-strong-secret-at-least-32-bytes>
```

These are **examples only**; do not put real values into Git. Configure secrets in a secret manager or host environment. `CORS_ALLOWED_ORIGINS` may contain a single frontend origin. Do not put paths, `*`, localhost HTTP, or trailing path components in production origin entries. Native React Native and mobile apps typically omit Origin and do not need a CORS allowlist entry. The allowlist blocks browser reading, not requests from scripts or native clients.

**Reverse proxies:** Express's default proxy trust is deliberately unchanged; rate limiters use the source IP visible to Express. Configure trusted proxy handling during deployment only after verifying the reverse proxy chain and its `X-Forwarded-For` rewriting. Never blindly enable `trust proxy = true` on a public interface. In-memory IP rate limits are per process, not distributed across multiple replicas. Add gateway/distributed rate limiting as needed.

## Tests

```bash
yarn typecheck
yarn build
yarn tsc -p tests/tsconfig.json --pretty false
yarn tsx --test tests/security.config.test.ts
yarn tsx --test tests/security.jwt.test.ts
yarn tsx --test tests/security.http.test.ts
DB_NAME=sara_migration_test yarn tsx --test tests/smart.api.integration.test.ts
DB_NAME=sara_migration_test yarn tsx --test tests/nlp.api.integration.test.ts
DB_NAME=sara_migration_test NOTIFICATION_PROVIDER=mock yarn tsx --test tests/notification.api.integration.test.ts
```

No new database migration or npm dependencies. Do not run destructive integration tests against `sara` or a production database. Local `node --test` processes may use `.env` provided by the developer; never commit runtime secrets.

## Important follow-up risks (not fixed by this slice)

- Cross-route schedule write serialization (Smart Assistance confirmation versus ordinary Activity CRUD) and the agreed policy for intentionally overlapping activities.
- Consistent reminder rescheduling/cancellation when an activity's time or status changes.
- JWT revocation/refresh, distributed rate limiting, audit monitoring, Firebase real-device end-to-end testing, deployment TLS configuration, dependency vulnerability review, backups, and disaster recovery.
