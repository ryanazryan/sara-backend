export type Validation<T> = { ok: true; data: T } | { ok: false; message: string };
export type NotificationPermission = "GRANTED" | "DENIED" | "UNKNOWN";
export type DeviceCreate = {
  installationId: string;
  platform: "android" | "ios";
  notificationPermission: NotificationPermission;
  fcmToken: string | null;
};
export type DevicePatch = {
  notificationPermission?: NotificationPermission;
  fcmToken?: string | null;
};
const invalid = <T>(message: string): Validation<T> => ({ ok: false, message });
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>) : null;
const permission = (v: unknown): v is NotificationPermission =>
  v === "GRANTED" || v === "DENIED" || v === "UNKNOWN";
function token(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.length < 10 || value.length > 4096 || /\s/.test(value)) return undefined;
  return value;
}
export function parseDeviceCreate(value: unknown): Validation<DeviceCreate> {
  const obj = record(value);
  if (!obj || Object.keys(obj).some((k) => !["installationId", "platform", "notificationPermission", "fcmToken"].includes(k)))
    return invalid("Invalid device request or unexpected field");
  if (typeof obj.installationId !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(obj.installationId))
    return invalid("installationId must be 8-128 safe characters");
  if (obj.platform !== "android" && obj.platform !== "ios") return invalid("platform must be android or ios");
  const p = obj.notificationPermission ?? "UNKNOWN";
  if (!permission(p)) return invalid("Invalid notificationPermission");
  const t = obj.fcmToken === undefined ? null : token(obj.fcmToken);
  if (t === undefined || (t !== null && p !== "GRANTED")) return invalid("fcmToken requires GRANTED permission and a valid token");
  return { ok: true, data: { installationId: obj.installationId, platform: obj.platform, notificationPermission: p, fcmToken: p === "GRANTED" ? t : null } };
}
export function parseDevicePatch(value: unknown): Validation<DevicePatch> {
  const obj = record(value);
  if (!obj || Object.keys(obj).length === 0 || Object.keys(obj).some((k) => !["notificationPermission", "fcmToken"].includes(k)))
    return invalid("Invalid device patch or unexpected field");
  const data: DevicePatch = {};
  if (Object.hasOwn(obj, "notificationPermission")) {
    if (!permission(obj.notificationPermission)) return invalid("Invalid notificationPermission");
    data.notificationPermission = obj.notificationPermission;
  }
  if (Object.hasOwn(obj, "fcmToken")) {
    const t = token(obj.fcmToken);
    if (t === undefined) return invalid("Invalid fcmToken");
    data.fcmToken = t;
  }
  if (data.fcmToken && data.notificationPermission && data.notificationPermission !== "GRANTED")
    return invalid("fcmToken requires GRANTED permission");
  return { ok: true, data };
}
