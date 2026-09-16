export type DiagnosticLevel = "debug" | "info" | "warn" | "error";
/** Explicit call-scoped correlation, never persisted in commands or saves. */
export interface DiagnosticContext {
  readonly operationId: string;
  readonly sessionId?: string;
}

/** Only explicit summaries belong here; never pass player text or a whole save. */
export interface DiagnosticEvent {
  source: string;
  event: string;
  level?: DiagnosticLevel;
  operationId?: string;
  sessionId?: string;
  data?: Readonly<Record<string, unknown>>;
  error?: unknown;
}

export interface Diagnostics {
  record(event: DiagnosticEvent): void;
  operationId(): string;
}

let sequence = 0;
let sink: (event: DiagnosticEvent) => void = () => undefined;
const diagnostics: Diagnostics = {
  record(event) {
    // Diagnostic transport is never part of a business transaction's success.
    try {
      sink(event);
    } catch {
      /* A broken observer must not change game facts. */
    }
  },
  operationId() {
    return `op-${Date.now().toString(36)}-${++sequence}`;
  },
};

export const getDiagnostics = (): Diagnostics => diagnostics;
export function configureDiagnostics(next: (event: DiagnosticEvent) => void): void {
  sink = next;
}
