import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDeviceCreate, parseDevicePatch } from "../src/validators/notification.validators.js";
import { NotificationSendError, mockNotificationSender, notificationSenderFromEnv } from "../src/services/notification-provider.service.js";

test("device create validates installation, platform, permission", () => {
  assert.equal(parseDeviceCreate({ installationId: "device-123456", platform: "android" }).ok, true);
  assert.equal(parseDeviceCreate({ installationId: "short", platform: "android" }).ok, false);
  assert.equal(parseDeviceCreate({ installationId: "device-123456", platform: "windows" }).ok, false);
});
test("FCM token is accepted only with notification permission", () => {
  assert.equal(parseDeviceCreate({ installationId: "device-123456", platform: "android", notificationPermission: "GRANTED", fcmToken: "token-example-abcdef" }).ok, true);
  assert.equal(parseDeviceCreate({ installationId: "device-123456", platform: "android", notificationPermission: "DENIED", fcmToken: "token-example-abcdef" }).ok, false);
});
test("device validators reject owner and unexpected fields", () => {
  assert.equal(parseDeviceCreate({ installationId: "device-123456", platform: "android", idPengguna: 2 }).ok, false);
  assert.equal(parseDevicePatch({ fcmToken: "token-example-abcdef", idPengguna: 2 }).ok, false);
  assert.equal(parseDevicePatch({}).ok, false);
  assert.equal(parseDevicePatch({ notificationPermission: "DENIED" }).ok, true);
});
test("mock provider returns opaque message id and provider errors stay classified", async () => {
  const id = await mockNotificationSender({ token: "test-token", title: "Test", body: "Hello", data: {} });
  assert.match(id, /^mock:/);
  const err = new NotificationSendError("FCM_UNREGISTERED", false, true);
  assert.equal(err.invalidToken, true);
  assert.equal(err.retryable, false);
});
test("mock cannot be configured in production", () => {
  const oldEnv = process.env.NODE_ENV;
  const oldProvider = process.env.NOTIFICATION_PROVIDER;
  try {
    process.env.NODE_ENV = "production";
    process.env.NOTIFICATION_PROVIDER = "mock";
    assert.throws(notificationSenderFromEnv, /prohibited/);
  } finally {
    if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv;
    if (oldProvider === undefined) delete process.env.NOTIFICATION_PROVIDER; else process.env.NOTIFICATION_PROVIDER = oldProvider;
  }
});
