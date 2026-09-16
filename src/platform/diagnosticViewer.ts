import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DiagnosticViewerService } from "../shared/diagnosticViewer";
import {
  getDiagnosticLocalSnapshot,
  getDiagnosticTransportStatus,
  getDiagnosticHeartbeatStatus,
  setDiagnosticDetailed,
  sanitizeDiagnostic,
} from "./diagnostics";

export function boundedFrontendSummary() {
  const local = getDiagnosticLocalSnapshot();
  const recent = [...(local?.recent ?? [])];
  let omittedRecent = 0;
  const summary = {
    frontendBuildId: import.meta.env.VITE_DIAGNOSTIC_BUILD_ID ?? "test",
    ...local,
    recent,
    transport: getDiagnosticTransportStatus(),
    heartbeat: getDiagnosticHeartbeatStatus(),
    coverage: { omittedRecent: 0, memoryWindow: 256, earlierRecordsUnavailable: true },
  };
  // Leave room for IPC serialization and native defensive projection. Keep the
  // newest records; omission is explicit rather than failing a noisy report.
  while (JSON.stringify(summary).length > 100_000 && recent.length) {
    recent.shift();
    omittedRecent++;
  }
  summary.coverage.omittedRecent = omittedRecent;
  return summary;
}
const frontend = boundedFrontendSummary;
// A timed-out native call cannot be cancelled. Disable that channel for this
// run instead of accumulating more outstanding IPC on repeated UI actions.
const disabled = new Set<string>();
const inFlight = new Set<string>();
async function request<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (disabled.has(command)) throw new Error("Diagnostic channel unavailable until reload");
  if (inFlight.has(command)) throw new Error("Diagnostic command already pending");
  inFlight.add(command);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      invoke<T>(command, args),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => {
            disabled.add(command);
            reject(new Error("Diagnostic timeout; completion unknown"));
          },
          command === "diagnostics_export" ? 10_000 : 1500,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    inFlight.delete(command);
  }
}
export const diagnosticViewer: DiagnosticViewerService = {
  async snapshot() {
    let host: unknown;
    try {
      host = isTauri() ? await request("diagnostics_snapshot") : { runtime: "browser-memory" };
    } catch {
      host = { unavailable: true };
    }
    return { ...frontend(), host };
  },
  async setDetailed(enabled) {
    setDiagnosticDetailed(enabled);
    if (isTauri()) await request("diagnostics_set_detailed", { enabled });
  },
  async exportReport() {
    if (isTauri()) return request<string>("diagnostics_export", { frontend: frontend() });
    const reportId = crypto.randomUUID();
    const local = frontend();
    const { recent = [], ...metadata } = local;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            protocolVersion: 1,
            reportId,
            createdAt: new Date().toISOString(),
            runtime: "browser-memory",
            frontend: { ...metadata, recent: recent.map((record) => sanitizeDiagnostic(record)) },
            coverage: {
              retainedRecords: recent.length,
              memoryWindow: 256,
              earlierRecordsUnavailable: true,
              perRecordSanitizationMayTruncate: true,
            },
            limitations: [
              "Memory window only; previous browser runs unavailable",
              "Redaction is best effort; review before sharing",
            ],
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `eagle-report-${reportId}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return anchor.download;
  },
};
