import { isTauri } from "@tauri-apps/api/core";

/**
 * Runtime detection is kept at the platform edge so domain and UI code do not
 * need to inspect browser globals or Tauri internals. The official helper
 * also keeps this check compatible with Tauri's webview bridge.
 */
export type RuntimeKind = "browser" | "tauri";

export interface RuntimeInfo {
  kind: RuntimeKind;
  supportsSqlite: boolean;
}

/**
 * The browser preview intentionally has no database capability. It is useful
 * for UI work while keeping SQLite access exclusive to the desktop runtime.
 */
export function detectRuntime(): RuntimeInfo {
  const kind: RuntimeKind = isTauri() ? "tauri" : "browser";
  return {
    kind,
    supportsSqlite: kind === "tauri",
  };
}
