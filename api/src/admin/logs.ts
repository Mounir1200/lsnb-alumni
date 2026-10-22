import { randomUUID } from "node:crypto";

export type LogLevel = "info" | "warn" | "error";
export type OperationalEvent = "api.ready" | "api.listening" | "api.stopping" | "api.stopped" |
  "api.start_failed" | "api.request" | "api.unhandled_error" | "highlights.unavailable" |
  "control.unavailable" | "maintenance.blocked";
export type LogEntry = {
  id: string;
  time: string;
  level: LogLevel;
  event: OperationalEvent;
  method?: string;
  path?: string;
  status?: number;
  duration_ms?: number;
  request_id?: string;
};
type RequestFields = Pick<LogEntry, "method" | "path" | "status" | "duration_ms" | "request_id">;

/** Deliberately structured: no arbitrary message, error, headers, URL, body or user payload. */
export function createOperationalLog(now: () => Date = () => new Date(), capacity = 500) {
  const startedAt = now().toISOString();
  const entries: LogEntry[] = [];
  return {
    record(level: LogLevel, event: OperationalEvent, fields: RequestFields = {}) {
      const entry: LogEntry = { id: randomUUID(), time: now().toISOString(), level, event };
      // An explicit field allowlist also protects against accidental object spreading by callers.
      if (fields.method !== undefined) entry.method = fields.method;
      if (fields.path !== undefined) entry.path = fields.path;
      if (fields.status !== undefined) entry.status = fields.status;
      if (fields.duration_ms !== undefined) entry.duration_ms = Math.round(fields.duration_ms);
      if (fields.request_id !== undefined) entry.request_id = fields.request_id;
      entries.push(entry);
      if (entries.length > capacity) entries.splice(0, entries.length - capacity);
      return entry;
    },
    snapshot(level: LogLevel | "all", limit: number) {
      return {
        entries: entries.filter((entry) => level === "all" || entry.level === level).slice(-limit).reverse().map((entry) => ({ ...entry })),
        started_at: startedAt,
        retention: "process" as const,
        service: "lsnb-alumni-api" as const,
        capacity,
      };
    },
  };
}

export type OperationalLog = ReturnType<typeof createOperationalLog>;
