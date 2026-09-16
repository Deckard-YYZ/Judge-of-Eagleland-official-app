import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BootstrapApp } from "./app/bootstrap";
import { ThemeLabPage } from "./ui/theme-lab";
import "./ui/app.css";
import { initializeDiagnostics } from "./platform/diagnostics";
import { installGlobalErrorLogging } from "./platform/globalErrors";
import { DiagnosticsShell } from "./app/DiagnosticsShell";

await initializeDiagnostics();
installGlobalErrorLogging();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("The application root element is missing.");
}

const themeLabEnabled = new URLSearchParams(window.location.search).get("themeLab") === "1";

createRoot(rootElement).render(
  <StrictMode>
    {/* Composition-root preview gate: Theme Lab never enters the production App tree. */}
    <DiagnosticsShell>{themeLabEnabled ? <ThemeLabPage /> : <BootstrapApp />}</DiagnosticsShell>
  </StrictMode>,
);
