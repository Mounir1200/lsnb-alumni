import "dotenv/config";
import { runNotificationRound } from "../notifications/delivery.js";
import { loadNotificationConfig, NotificationError } from "./notifications.js";
import { notificationChannels } from "./scheduler.js";

try {
  // Validate everything before claiming jobs, including before any delivery attempt.
  const config = loadNotificationConfig();
  const result = { event: "messaging.notifications", ...await runNotificationRound(notificationChannels(config)) };
  console.info(JSON.stringify(result));
  if (result.failed) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ event: "messaging.notifications.failed",
    stage: error instanceof NotificationError ? error.stage : "unexpected",
    status: error instanceof NotificationError ? error.status : 0 }));
  process.exitCode = 1;
}
