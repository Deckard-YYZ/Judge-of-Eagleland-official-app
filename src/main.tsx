import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createDemoSession } from "./app/demoSession";
import { detectRuntime } from "./platform/runtime";
import { probeDatabase } from "./storage/database";
import { App, type AppProps } from "./ui/App";
import "./ui/app.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("The application root element is missing.");
}

const runtime = detectRuntime();
const demo = createDemoSession();
const root = createRoot(rootElement);

function render(databaseProbe: AppProps["databaseProbe"]): void {
  root.render(
    <StrictMode>
      <App
        runtimeStatus={{
          kind: runtime.kind,
          supportsSqlite: runtime.supportsSqlite,
        }}
        databaseProbe={databaseProbe}
        session={demo.session}
        reloadSession={demo.reload}
      />
    </StrictMode>,
  );
}

render({
  status: "checking",
  databaseUrl: "sqlite:judge.db",
  message: "正在检查桌面运行环境…",
});

async function bootstrap(): Promise<void> {
  const [probe] = await Promise.all([probeDatabase(runtime), demo.reload()]);
  render(probe);
}

void bootstrap();
