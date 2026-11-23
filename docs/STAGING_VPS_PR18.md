# SARA staging VPS — HTTPS API for the mobile team

This is a **staging environment**, not an unqualified production release. It allows the React Native team to start coding against a stable HTTPS API **before PR #19**. PR #19 is the later real-device end-to-end verification phase.

## Prerequisites

- A VPS (suggested Ubuntu 24.04 LTS; 2 vCPU / 4 GB RAM for a small staging environment).
- Docker Engine and Docker Compose v2 installed on the VPS, with SSH access for a non-root operator.
- A domain such as `api-staging.example.com` whose DNS A/AAAA records point to the VPS public IP. **Replace example.com with a domain you control.**
- Firewall: allow SSH only from trusted sources; public TCP 80 and 443 for HTTPS; **do not expose 3306 or 3000 publicly**.
- Tested ability to send OTP email (Resend verified sender), if registration/login is needed for the mobile integration tests.

## Deploy from reviewed main

```bash
git clone https://github.com/ryanazryan/sara-backend.git
cd sara-backend
cp .env.docker.example .env.docker
```

Edit `.env.docker` on the VPS itself. Set `NODE_ENV=production`, `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, `JWT_SECRET`, `OTP_PEPPER` to distinct securely generated values. Set `CORS_ALLOWED_ORIGINS` to the intended *web client* HTTPS origin (for native React Native requests without `Origin`, CORS is not the primary access control), `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `SARA_API_DOMAIN=api-staging.example.com`. Note that `NODE_ENV=production` enforces nonempty valid CORS origins and distinct secure JWT/OTP secrets.

For the initial **API-only** staging deployment, leave the notification worker stopped until actual FCM credentials are available. `NOTIFICATION_PROVIDER=mock` is forbidden in production; setting `NOTIFICATION_PROVIDER=fcm` alone does not make Firebase functional. Device push notifications will be tested later with a physical device and a real Firebase service account.

```bash
docker compose --env-file .env.docker -f compose.yaml -f compose.staging.yaml config --quiet
docker compose --env-file .env.docker -f compose.yaml -f compose.staging.yaml build api
docker compose --env-file .env.docker -f compose.yaml -f compose.staging.yaml up -d --wait api reverse-proxy
docker compose --env-file .env.docker -f compose.yaml -f compose.staging.yaml ps -a
```

The `migrate` service should exit `0`; `mysql` and `api` should be `healthy`. The staging overlay sets `TRUST_PROXY_HOPS=1` on the API so IP rate limits work correctly through Caddy. Keep the API host port bound to `127.0.0.1` and do not enable trust proxy for directly exposed/untrusted deployments. Caddy needs working DNS and TCP 80/443 to obtain a certificate automatically. Caddy may be restarted while DNS propagates: check `logs reverse-proxy` before claiming HTTPS works.

Check externally (from a different network):

```bash
curl -i https://api-staging.example.com/api/health
curl -i https://api-staging.example.com/api/ready
curl -i https://api-staging.example.com/api/auth/me
```

Expected HTTP codes: `200`, `200`, and `401` respectively. Replace the domain in commands. Do not publish the API URL to the team until TLS and migrations have been verified, and email OTP has been tested if authentication is part of their workflow.

### Mobile team handoff

Give the team only:

- API base URL: `https://api-staging.yourdomain.tld/api`
- OpenAPI: `docs/api/SARA_OpenAPI_v1.yaml`
- Postman: `postman/SARA_Backend.postman_collection.json`
- Authentication flow: register -> verify OTP -> login -> `Authorization: Bearer <accessToken>`

**Never** share `.env.docker`, JWT secret, database passwords, or Firebase service-account JSON. Ask the mobile developers to report endpoint, HTTP method, status code and `X-Request-ID` when something fails. Do not send credentials or user data in bug reports.

### FCM later (optional)

Keep the Firebase JSON file outside the repository and readable only by the operator. Configure `FCM_SERVICE_ACCOUNT_PATH` to its absolute VPS path, then use `compose.fcm.yaml` together with the base and staging files to start `worker` after confirming the Firebase project settings. This must be accompanied by real-device tests; mock notification results are not delivery proof.

### Important production caveats

The base Compose runs MySQL with `--skip-log-bin` for trigger migrations. This is acceptable only for **standalone disposable staging** where binary-log replication and point-in-time recovery are not needed. Do not reuse it unreviewed for production with strict recovery targets. PR #18 provides manual backups, not automatic encrypted/offsite backups. Validate restores, enable monitoring and configure alerting before general public launch.

No deployment was performed by creating these files: the VPS owner still needs to run and verify this deployment on their infrastructure.
