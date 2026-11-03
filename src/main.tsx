import {
  readModulePreview,
  readInstructionVariant,
  readNewsVariant,
  readAttributeVariant,
  readAttributeMarker,
  readChatVariant,
} from "./app/debugPreviewRoutes";
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

const modulePreview = readModulePreview(window.location.search, import.meta.env.DEV);
const themeLabEnabled =
  !modulePreview && new URLSearchParams(window.location.search).get("themeLab") === "1";
let applicationBootstrap = bootstrapApplication;
const mainFlowPreview =
  !modulePreview &&
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("mainFlowPreview") === "1";
if (modulePreview) {
  const { bootstrapModulePreview } = await import("./app/modulePreview");
  applicationBootstrap = async () => ({
    ...(await bootstrapModulePreview(
      modulePreview,
      readChatVariant(window.location.search, import.meta.env.DEV),
    )),
    chatVariant: readChatVariant(window.location.search, import.meta.env.DEV),
    attributeMarker: readAttributeMarker(window.location.search, import.meta.env.DEV),
    attributeVariant: readAttributeVariant(window.location.search, import.meta.env.DEV),
    newsVariant: readNewsVariant(window.location.search, import.meta.env.DEV),
    instructionVariant: readInstructionVariant(window.location.search, import.meta.env.DEV),
  });
}
if (mainFlowPreview) {
  const { bootstrapMainFlowPreview } = await import("./app/mainFlowPreview");
  applicationBootstrap = bootstrapMainFlowPreview;
}
if (
  import.meta.env.DEV &&
  !modulePreview &&
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
