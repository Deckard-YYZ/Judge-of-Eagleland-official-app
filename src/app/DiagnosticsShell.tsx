import { useState, type ReactNode } from "react";
import { diagnosticViewer } from "../platform/diagnosticViewer";
import { DiagnosticsPanel } from "../ui/DiagnosticsPanel";
import { DiagnosticErrorBoundary } from "./DiagnosticErrorBoundary";

/** Outside startup/render failure boundaries so evidence remains accessible. */
export function DiagnosticsShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DiagnosticErrorBoundary onDiagnostics={() => setOpen(true)}>
        {children}
      </DiagnosticErrorBoundary>
      <button type="button" className="diagnostics-launcher" onClick={() => setOpen(true)}>
        诊断 / Diagnostics
      </button>
      {open && <DiagnosticsPanel service={diagnosticViewer} onClose={() => setOpen(false)} />}
    </>
  );
}
