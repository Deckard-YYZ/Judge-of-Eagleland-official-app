import { getCurrentWindow } from "@tauri-apps/api/window";
import { getDiagnostics } from "../shared/diagnostics";
import { detectRuntime } from "./runtime";

export type WindowTheme = "light" | "dark";
let pendingTheme: Promise<void> = Promise.resolve();

/** Serialize native writes so a slower earlier switch cannot win over the latest one. */
export function syncWindowTheme(theme: WindowTheme): Promise<void> {
  if (detectRuntime().kind !== "tauri") return Promise.resolve();

  pendingTheme = pendingTheme
    .then(() => getCurrentWindow().setTheme(theme))
    .catch((error: unknown) => {
      // Appearance failure must not interrupt gameplay or prevent later switches.
      getDiagnostics().record({
        source: "window",
        event: "window.theme_failed",
        level: "warn",
        data: { theme },
        error,
      });
    });
  return pendingTheme;
}
