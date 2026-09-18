import { invoke, isTauri } from "@tauri-apps/api/core";
import { configureDiagnostics, type DiagnosticEvent } from "../shared/diagnostics";
import { startDiagnosticHeartbeat } from "./diagnosticHeartbeat";

export interface DiagnosticIdentity {
  runId: string;
  buildId: string;
  development: boolean;
}
export interface DiagnosticRecord extends DiagnosticIdentity {
  timestamp: string;
  sequence: number;
  process: "frontend";
  source: string;
  event: string;
  level: string;
  operationId?: string;
  sessionId?: string;
  data?: unknown;
  error?: unknown;
}

const sensitiveKey = /^(text|input|raw|displayName|password|token|save|snapshot|state)$/i;
const summaryKeys = new Set([
  "modelId",
  "sampleRate",
  "sampleCount",
  "maxFrameRms",
  "frameDurationMs",
  "rms",
  "peak",
  "rmsDbfs",
  "dbfsFloor",
  "dbfsFloored",
  "nearZeroRatio",
  "nearZeroThreshold",
  "clippedRatio",
  "clippingThreshold",
  "invalidSampleCount",
  "audioContextSampleRate",
  "channelCount",
  "echoCancellation",
  "noiseSuppression",
  "autoGainControl",
  "maxActivePaths",
  "trailingBlanks",
  "keywordsScore",
  "keywordsThreshold",
  "keywordCount",
  "loadMode",
  "loadDurationMs",
  "decodeCount",
  "decodeDurationMs",
  "hitCount",
  "actionIds",
  "unknownReason",

  "inputMode",
  "frontendBuildId",
  "issues",
  "feedback",
  "componentStack",
  "line",
  "column",
  "commandType",
  "storyId",
  "stepId",
  "checkpoint",
  "expectedRevision",
  "revision",
  "contentPackageId",
  "contentVersion",
  "code",
  "phase",
  "outcome",
  "actionId",
  "recognition",
  "inputLength",
  "durationMs",
  "status",
  "runtime",
  "storageMode",
  "transport",
  "reason",
  "caseId",
  "source",
  "locale",
  "count",
  "attempt",
  "queueLength",
  "fromRevision",
  "toRevision",
  "previousStatus",
  "nextStatus",
  "schemaVersion",
  "fromVersion",
  "toVersion",
  "resource",
  "issueCount",
  "path",
  "operationType",
  "stage",
]);
function redact(value: string): string {
  return value
    .replace(/[A-Z]:[\\/]Users[\\/][^\\/\s]+/gi, "<user-home>")
    .replace(/\/(?:home|Users)\/[^/\s]+/g, "<user-home>")
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, "$1<credentials>@")
    .replace(/((?:token|password|authorization|api[_-]?key)\s*[=:]\s*)[^\s&,;]+/gi, "$1<redacted>");
}
function safeProperty(value: object, key: string): unknown {
  try {
    let current: object | null = value;
    for (let depth = 0; current && depth < 5; depth++) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) return "value" in descriptor ? descriptor.value : "[unreadable]";
      current = Object.getPrototypeOf(current) as object | null;
    }
    return undefined;
  } catch {
    return "[unreadable]";
  }
}
/** Bound traversal and strings; avoid accessors, cycles and arbitrary serialization hooks. */
export function sanitizeDiagnostic(
  value: unknown,
  depth = 0,
  seen = new Set<object>(),
  budget = { remaining: 8000 },
): unknown {
  if (budget.remaining <= 0) return "[truncated]";
  budget.remaining -= 32;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const result = redact(value.slice(0, Math.max(0, Math.min(2048, budget.remaining))));
    budget.remaining -= result.length;
    return result;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value !== "object") return String(typeof value);
  if (depth >= 4 || seen.has(value)) return "[truncated]";
  seen.add(value);
  if (value instanceof Error) {
    return Object.fromEntries(
      ["name", "message", "stack", "cause", "code"].map((key) => [
        key,
        sanitizeDiagnostic(safeProperty(value, key), depth + 1, seen, budget),
      ]),
    );
  }
  if (Array.isArray(value))
    return value.slice(0, 16).map((item) => sanitizeDiagnostic(item, depth + 1, seen, budget));
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).slice(0, 24)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    result[key.slice(0, 100)] = sensitiveKey.test(key)
      ? "[redacted]"
      : descriptor && "value" in descriptor
        ? sanitizeDiagnostic(descriptor.value, depth + 1, seen, budget)
        : "[accessor]";
  }
  return result;
}

function summarize(data: DiagnosticEvent["data"]): unknown {
  if (!data) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(data).slice(0, 48)) {
    if (summaryKeys.has(key)) {
      const descriptor = Object.getOwnPropertyDescriptor(data, key);
      if (descriptor && "value" in descriptor) result[key] = descriptor.value;
    }
  }
  return sanitizeDiagnostic(result);
}

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Diagnostic transport timeout")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createDiagnosticTransport(
  identity: DiagnosticIdentity,
  send: (records: DiagnosticRecord[]) => Promise<unknown>,
  capacity = 256,
  timeoutMs = 2000,
) {
  const queue: DiagnosticRecord[] = [];
  const recent: DiagnosticRecord[] = [];
  let detailedUntil = 0;
  let detailedDeadline = 0;
  let sequence = 0;
  let active = false;
  let dropped = 0;
  let failures = 0;
  let unavailable = false;
  const drain = async (): Promise<void> => {
    if (active) return;
    active = true;
    try {
      while (queue.length) {
        const records = queue.splice(0, 32);
        try {
          await bounded(send(records), timeoutMs);
        } catch {
          // Stop after uncertain IPC completion: retries could accumulate pending
          // native calls. Health remains visible and a new run can reconnect.
          failures++;
          dropped += records.length + queue.length;
          queue.length = 0;
          unavailable = true;
        }
      }
    } finally {
      active = false;
    }
  };
  return {
    record(event: DiagnosticEvent): void {
      try {
        if (
          !identity.development &&
          performance.now() >= detailedDeadline &&
          event.level === "debug"
        )
          return;
        if (unavailable) {
          dropped++;
          return;
        }
        if (queue.length >= capacity) {
          dropped++;
          return;
        }
        const record: DiagnosticRecord = {
          runId: identity.runId,
          buildId: identity.buildId,
          development: identity.development,
          timestamp: new Date().toISOString(),
          sequence: ++sequence,
          process: "frontend",
          source: event.source.slice(0, 100),
          event: event.event.slice(0, 100),
          level: event.level ?? "info",
          operationId: event.operationId?.slice(0, 100),
          sessionId: event.sessionId?.slice(0, 100),
          data: summarize(event.data),
          error: event.error === undefined ? undefined : sanitizeDiagnostic(event.error),
        };
        if (identity.development) {
          try {
            console.debug("[diagnostic]", record);
          } catch {
            /* Console can also be unavailable. */
          }
        }
        recent.push(record);
        if (recent.length > 256) recent.shift();
        queue.push(record);
        void drain();
      } catch {
        failures++;
      }
    },
    setDetailed: (enabled: boolean) => {
      detailedUntil = enabled ? Date.now() + 300_000 : 0;
      detailedDeadline = enabled ? performance.now() + 300_000 : 0;
    },
    snapshot: () => ({
      identity,
      recent: [...recent],
      detailedUntil,
      level: identity.development || performance.now() < detailedDeadline ? "debug" : "info",
    }),
    status: () => ({ queued: queue.length, dropped, failures, active, unavailable }),
  };
}

let transport: ReturnType<typeof createDiagnosticTransport> | undefined;
let initializationFailed = false;
let heartbeat: ReturnType<typeof startDiagnosticHeartbeat> | undefined;
export const getDiagnosticHeartbeatStatus = () => heartbeat?.status();
export const getDiagnosticTransportStatus = () =>
  transport?.status() ?? {
    queued: 0,
    dropped: 0,
    failures: initializationFailed ? 1 : 0,
    active: false,
    unavailable: initializationFailed,
  };

/** Called before React composition; handshake failure does not prevent startup. */
export async function initializeDiagnostics(): Promise<void> {
  try {
    const desktop = isTauri();
    const identity = desktop
      ? await bounded(invoke<DiagnosticIdentity>("diagnostics_identity"), 1500)
      : {
          runId: crypto.randomUUID(),
          buildId: import.meta.env.VITE_DIAGNOSTIC_BUILD_ID ?? "test",
          development: import.meta.env.DEV,
        };
    transport = createDiagnosticTransport(identity, (records) =>
      desktop ? invoke("diagnostics_write", { records }) : Promise.resolve(),
    );
    configureDiagnostics(transport.record);
    if (desktop) {
      heartbeat?.stop();
      heartbeat = startDiagnosticHeartbeat();
    }
    transport.record({
      source: "frontend",
      event: "frontend.started",
      data: {
        transport: desktop ? "file" : "console",
        frontendBuildId: import.meta.env.VITE_DIAGNOSTIC_BUILD_ID ?? "test",
      },
    });
  } catch {
    initializationFailed = true;
    try {
      console.warn("Diagnostics unavailable; application startup will continue.");
    } catch {
      /* Never block application startup on a diagnostic failure. */
    }
  }
}

export const getDiagnosticLocalSnapshot = () => transport?.snapshot();
export const setDiagnosticDetailed = (enabled: boolean) => transport?.setDetailed(enabled);
