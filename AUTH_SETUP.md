# SARA Authentication Slice 1

This adds real backend authentication, not a production-approved full security review.

## Install

On a clean branch created from latest `origin/main`, apply this patch and run:

```bash
yarn add resend jose express-rate-limit
```

## Environment

Preserve your existing `.env`. Append (do NOT commit secret values):

```dotenv
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=onboarding@resend.dev
JWT_SECRET=<random 32+ byte secret>
OTP_PEPPER=<different random 32+ byte secret>
```

Generate secrets locally twice using `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
`onboarding@resend.dev` is intended for Resend testing. Verify your own sender domain for real recipients.

## Database

Two versioned, single-statement migrations (0004/0005) are added. Existing 0001-0003 are unchanged.
Apply to `sara_migration_test` first and check `DB_NAME`:

```bash
DB_NAME=sara_migration_test yarn db:migrate:status
DB_NAME=sara_migration_test yarn db:migrate
DB_NAME=sara_migration_test yarn db:migrate:status
```

Do not run migrations against production or your main development DB without checking the schema and backup.

## Check

```bash
yarn typecheck
yarn build
yarn tsc -p tests/tsconfig.json --pretty false
yarn tsx --test tests/auth.unit.test.ts
DB_NAME=sara_migration_test yarn tsx --test tests/schema.integration.test.ts
```

## Endpoints

- POST `/api/auth/register` `{ "fullName": "Ryan", "email": "ryan@example.com", "password": "SARA12345", "confirmPassword": "SARA12345" }` — creates an unverified user, sends OTP. Returns 201 on email acceptance. Does NOT return a session token.
- POST `/api/auth/verify-email` `{ "email": "ryan@example.com", "code": "123456" }`
- POST `/api/auth/resend-otp` `{ "email": "ryan@example.com" }` — 60-second cooldown
- POST `/api/auth/login` `{ "email": "ryan@example.com", "password": "SARA12345" }` — returns `{ success:true, data:{token,user} }` **after** verification
- GET `/api/auth/me` — requires `Authorization: Bearer <token>`

OTP codes are cryptographically random, HMAC-hashed, expire in 5 minutes, and have at most 5 failed attempts per issued code. Login passwords are hashed with salted Node.js scrypt. JWTs use HS256 and expire in 7 days. Authentication routes use a shared IP rate limit; production deployments should use a shared rate-limit store for multiple instances and an explicit CORS policy.

## Mobile contract / Week 9

The mobile `authService.ts` currently returns stub sessions. Registration must transition to an OTP verification screen; do not assume registration returns a token. Apply the same email/password regex rules to `src/hooks/domain/auth/schema.ts` in the mobile repo and show validation errors in the Register form as Week 9 evidence. This patch changes backend only.

## Limitations to resolve before production

The registration and OTP send are not an atomic external-email transaction: if Resend fails, the user may be persisted unverified and can retry via resend-otp. The email sender must be on a verified domain for actual users. Other security tasks: app-managed refresh token or shorter JWT lifetime, revocation, password reset, account lockout policy, monitoring, input size limits, strict CORS, tests for route authorization, and deployment secrets management.
