import { getDiagnostics } from "../shared/diagnostics";

/** Observe errors without preventDefault: browser visibility remains intact. */
export function installGlobalErrorLogging(target: Window = window): () => void {
  const error = (event: ErrorEvent): void =>
    getDiagnostics().record({
      source: "frontend",
      event: "frontend.uncaught_error",
      level: "error",
      error: event.error ?? new Error(event.message),
      data: { resource: event.filename, line: event.lineno, column: event.colno },
    });
  const rejection = (event: PromiseRejectionEvent): void =>
    getDiagnostics().record({
      source: "frontend",
      event: "frontend.unhandled_rejection",
      level: "error",
      error: event.reason,
    });
  target.addEventListener("error", error);
  target.addEventListener("unhandledrejection", rejection);
  return () => {
    target.removeEventListener("error", error);
    target.removeEventListener("unhandledrejection", rejection);
  };
}
