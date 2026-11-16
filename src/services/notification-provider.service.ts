import { createSign, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

export class NotificationSendError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly invalidToken = false,
  ) {
    super(code);
  }
}

export type NotificationSender = (input: {
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
}) => Promise<string>;

export const mockNotificationSender: NotificationSender = async () => `mock:${randomUUID()}`;

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
let cachedAccessToken: { value: string; validUntil: number } | null = null;
let cachedAccount: ServiceAccount | null = null;

async function serviceAccount(): Promise<ServiceAccount> {
  if (cachedAccount) return cachedAccount;
  const filename = process.env.FCM_SERVICE_ACCOUNT_FILE;
  if (!filename) throw new NotificationSendError("FCM_SERVICE_ACCOUNT_NOT_CONFIGURED", false);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filename, "utf8"));
  } catch {
    throw new NotificationSendError("FCM_SERVICE_ACCOUNT_INVALID", false);
  }
  if (!parsed || typeof parsed !== "object") throw new NotificationSendError("FCM_SERVICE_ACCOUNT_INVALID", false);
  const item = parsed as Record<string, unknown>;
  if (typeof item.project_id !== "string" || typeof item.client_email !== "string" || typeof item.private_key !== "string")
    throw new NotificationSendError("FCM_SERVICE_ACCOUNT_INVALID", false);
  cachedAccount = { project_id: item.project_id, client_email: item.client_email, private_key: item.private_key };
  return cachedAccount;
}

async function oauthAccessToken(account: ServiceAccount): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessToken.validUntil) return cachedAccessToken.value;
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({
    iss: account.client_email,
    sub: account.client_email,
    aud: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    iat: now,
    exp: now + 3600,
  })).toString("base64url");
  const input = `${head}.${body}`;
  let signature: string;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(input);
    signature = signer.sign(account.private_key).toString("base64url");
  } catch {
    throw new NotificationSendError("FCM_PRIVATE_KEY_INVALID", false);
  }
  let response: globalThis.Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${input}.${signature}` }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new NotificationSendError("FCM_OAUTH_NETWORK", true);
  }
  if (!response.ok) throw new NotificationSendError(`FCM_OAUTH_${response.status}`, response.status >= 500 || response.status === 429);
  const json: unknown = await response.json();
  if (!json || typeof json !== "object" || typeof (json as { access_token?: unknown }).access_token !== "string")
    throw new NotificationSendError("FCM_OAUTH_INVALID_RESPONSE", true);
  const data = json as { access_token: string; expires_in?: number };
  cachedAccessToken = { value: data.access_token, validUntil: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 120) * 1000 };
  return data.access_token;
}

export const fcmNotificationSender: NotificationSender = async (input) => {
  const account = await serviceAccount();
  const accessToken = await oauthAccessToken(account);
  let response: globalThis.Response;
  try {
    response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: {
        token: input.token,
        notification: { title: input.title, body: input.body },
        data: input.data,
      } }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new NotificationSendError("FCM_NETWORK", true);
  }
  if (!response.ok) {
    // Do not log raw provider responses (may contain identifiers).
    let details: unknown;
    try { details = await response.json(); } catch { details = null; }
    const error = details && typeof details === "object" ? (details as { error?: { status?: string; details?: Array<{ errorCode?: string }> } }).error : undefined;
    const code = error?.details?.find((d) => typeof d.errorCode === "string")?.errorCode ?? error?.status ?? `HTTP_${response.status}`;
    const unregistered = code === "UNREGISTERED";
    if (response.status === 401) cachedAccessToken = null;
    throw new NotificationSendError(`FCM_${code}`.slice(0, 64), [429, 500, 502, 503, 504].includes(response.status), unregistered);
  }
  const result: unknown = await response.json();
  const name = result && typeof result === "object" ? (result as { name?: unknown }).name : undefined;
  if (typeof name !== "string") throw new NotificationSendError("FCM_INVALID_RESPONSE", true);
  return name.slice(0, 255);
};

export function notificationSenderFromEnv(): NotificationSender {
  const provider = process.env.NOTIFICATION_PROVIDER ?? (process.env.NODE_ENV === "production" ? "fcm" : "mock");
  if (provider === "mock") {
    if (process.env.NODE_ENV === "production") throw new Error("Mock notification provider prohibited in production");
    return mockNotificationSender;
  }
  if (provider === "fcm") return fcmNotificationSender;
  throw new Error("NOTIFICATION_PROVIDER must be mock or fcm");
}
