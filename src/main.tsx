import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BootstrapApp, bootstrapApplication, detectApplicationRuntime } from "./app/bootstrap";
import { ThemeLabPage } from "./ui/theme-lab";
import "./ui/app.css";
import { initializeDiagnostics } from "./platform/diagnostics";
import { installGlobalErrorLogging } from "./platform/globalErrors";
import { DiagnosticsShell } from "./app/DiagnosticsShell";
import { VoiceInputShell } from "./app/VoiceInputShell";

await initializeDiagnostics();
installGlobalErrorLogging();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("The application root element is missing.");
}

const themeLabEnabled = new URLSearchParams(window.location.search).get("themeLab") === "1";
let applicationBootstrap = bootstrapApplication;
const mainFlowPreview =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get("mainFlowPreview") === "1";
if (mainFlowPreview) {
  const { bootstrapMainFlowPreview } = await import("./app/mainFlowPreview");
  applicationBootstrap = bootstrapMainFlowPreview;
}
if (
  import.meta.env.DEV &&
  !mainFlowPreview &&
  detectApplicationRuntime() === "browser" &&
  new URLSearchParams(window.location.search).get("configurationPilot") === "1"
) {
  const { createConfigurationPilotProfileEntry } = await import("./app/configurationPilot");
  applicationBootstrap = () =>
    bootstrapApplication({ createDemoProfileEntry: createConfigurationPilotProfileEntry });
}

createRoot(rootElement).render(
  <StrictMode>
    {/* Composition-root preview gate: Theme Lab never enters the production App tree. */}
    <DiagnosticsShell>
      <VoiceInputShell>
        {themeLabEnabled ? (
          <ThemeLabPage />
        ) : (
          <BootstrapApp bootstrap={applicationBootstrap} mainFlowPreview={mainFlowPreview} />
        )}
      </VoiceInputShell>
    </DiagnosticsShell>
  </StrictMode>,
);
