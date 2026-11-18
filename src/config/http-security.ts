/** Security-critical configuration. Fail closed on invalid production settings. */
export type CorsPolicy = { wildcard: true; origins: [] } | { wildcard: false; origins: string[] };

export function parseCorsPolicy(raw: string | undefined, environment: string | undefined): CorsPolicy {
  const values = raw?.split(",").map((value) => value.trim()) ?? [];
  if (values.length === 1 && values[0] === "") values.length = 0;
  if (values.length === 0) {
    if (environment === "production") {
      throw new Error("CORS_ALLOWED_ORIGINS must be configured in production");
    }
    return { wildcard: true, origins: [] };
  }
  const origins = new Set<string>();
  for (const value of values) {
    if (!value || value === "*" || value === "null") throw new Error("Invalid CORS_ALLOWED_ORIGINS entry");
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("Invalid CORS_ALLOWED_ORIGINS URL"); }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("CORS origin must use HTTP(S)");
    if (environment === "production" && url.protocol !== "https:") {
      throw new Error("Production CORS origins must use HTTPS");
    }
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
        (value !== url.origin && value !== `${url.origin}/`)) {
      throw new Error("CORS_ALLOWED_ORIGINS must contain origins, not paths or credentials");
    }
    origins.add(url.origin);
  }
  return { wildcard: false, origins: [...origins] };
}

export function isCorsOriginAllowed(policy: CorsPolicy, origin: string | undefined): boolean {
  // Native clients, curl, Postman, and server-to-server requests have no Origin.
  if (origin === undefined) return true;
  return policy.wildcard || policy.origins.includes(origin);
}

export function assertProductionSecurityConfig(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== "production") return;
  parseCorsPolicy(env.CORS_ALLOWED_ORIGINS, env.NODE_ENV);
  for (const field of ["JWT_SECRET", "OTP_PEPPER"] as const) {
    if (!env[field] || Buffer.byteLength(env[field], "utf8") < 32) {
      throw new Error(`${field} must contain at least 32 bytes in production`);
    }
  }
  if (env.JWT_SECRET === env.OTP_PEPPER) throw new Error("JWT_SECRET and OTP_PEPPER must differ");
}
