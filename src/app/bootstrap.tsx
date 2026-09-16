import { useCallback, useEffect, useRef, useState } from "react";
import { createDemoProfileEntry } from "./demoProfiles";
import { createDesktopProfileEntry, type DesktopProfileEntryOptions } from "./desktopProfiles";
import { App } from "../ui/App";
import {
  initializeStorage,
  type DatabaseInitializationOptions,
  type StorageRepositories,
} from "../storage";
import type { ProfileEntry } from "../application/profileEntry";
import { detectRuntime, type RuntimeInfo } from "../platform/runtime";

export type ApplicationRuntime = "desktop" | "browser";
export type ApplicationStorageMode = "sqlite" | "memory-preview";

export interface DesktopBootstrapResult {
  readonly runtime: "desktop";
  readonly storageMode: "sqlite";
  readonly profileEntry: ProfileEntry;
  readonly storage: StorageRepositories;
}

export interface BrowserBootstrapResult {
  readonly runtime: "browser";
  readonly storageMode: "memory-preview";
  readonly profileEntry: ProfileEntry;
}

export type ApplicationBootstrapResult = DesktopBootstrapResult | BrowserBootstrapResult;

export interface BootstrapDependencies {
  /** Runtime injection keeps browser tests independent from the Tauri bridge. */
  detectRuntime?: () => ApplicationRuntime | RuntimeInfo;
  initializeStorage?: (options?: DatabaseInitializationOptions) => Promise<StorageRepositories>;
  createDesktopProfileEntry?: (
    storage: Pick<StorageRepositories, "profiles" | "saves" | "settings">,
    options?: DesktopProfileEntryOptions,
  ) => Promise<ProfileEntry>;
  createDemoProfileEntry?: () => ProfileEntry;
  storageOptions?: DatabaseInitializationOptions;
  desktopProfileOptions?: DesktopProfileEntryOptions;
}

/** Keep platform detection at the platform edge; app code only maps its result. */
export const detectApplicationRuntime = (): ApplicationRuntime =>
  detectRuntime().kind === "tauri" ? "desktop" : "browser";

/**
 * Compose the application once. Browser development explicitly uses the
 * in-memory sample; only the desktop branch opens the SQLite plugin.
 */
export async function bootstrapApplication(
  dependencies: BootstrapDependencies = {},
): Promise<ApplicationBootstrapResult> {
  const detectedRuntime = (dependencies.detectRuntime ?? detectApplicationRuntime)();
  const runtime =
    typeof detectedRuntime === "string"
      ? detectedRuntime
      : detectedRuntime.kind === "tauri"
        ? "desktop"
        : "browser";
  if (runtime === "browser") {
    return Object.freeze({
      runtime,
      storageMode: "memory-preview" as const,
      profileEntry: (dependencies.createDemoProfileEntry ?? createDemoProfileEntry)(),
    });
  }

  const storage = await (dependencies.initializeStorage ?? initializeStorage)(
    dependencies.storageOptions,
  );
  let profileEntry: ProfileEntry;
  try {
    profileEntry = await (dependencies.createDesktopProfileEntry ?? createDesktopProfileEntry)(
      storage,
      dependencies.desktopProfileOptions,
    );
  } catch (error) {
    // Profile loading is part of this attempt. Close only the connection opened
    // by this failed composition; a successful application owns it for life.
    await storage.database.close().catch(() => undefined);
    throw error;
  }
  return Object.freeze({
    runtime,
    storageMode: "sqlite" as const,
    profileEntry,
    storage,
  });
}

type BootstrapViewState =
  | Readonly<{ status: "loading"; result: null; error: null }>
  | Readonly<{ status: "ready"; result: ApplicationBootstrapResult; error: null }>
  | Readonly<{ status: "error"; result: null; error: unknown }>;

const initialViewState: BootstrapViewState = Object.freeze({
  status: "loading",
  result: null,
  error: null,
});

const describeBootstrapError = (error: unknown): string => {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return "The local storage could not be initialized.";
};

export interface BootstrapAppProps {
  bootstrap?: () => Promise<ApplicationBootstrapResult>;
  caseOpenDelayMs?: number;
  decisionRevealDelayMs?: number;
}

/** Visible startup boundary for SQLite initialization and its retry path. */
export function StorageStartupScreen({
  status,
  error,
  onRetry,
}: {
  status: "loading" | "error";
  error?: unknown;
  onRetry?: () => void;
}) {
  const isError = status === "error";
  return (
    <main className="startup-screen" aria-labelledby="startup-title">
      <section className="startup-screen__panel">
        <p className="kicker">司法档案处 · 00</p>
        <h1 id="startup-title">{isError ? "本地存储无法初始化" : "正在准备本地档案"}</h1>
        <p role={isError ? "alert" : "status"} aria-live="polite">
          {isError
            ? "SQLite 尚未完成初始化。为保护已有存档，应用不会切换到内存模式。"
            : "正在打开本机数据库并读取存储结构，请稍候。"}
        </p>
        {isError ? (
          <>
            <p className="startup-screen__detail">{describeBootstrapError(error)}</p>
            <button className="button button--primary" type="button" onClick={onRetry}>
              重试本地存储
            </button>
          </>
        ) : null}
      </section>
    </main>
  );
}

/**
 * React boundary around the asynchronous composition root. The in-flight
 * promise is shared across React development effect replays, while a failed
 * attempt is cleared so the user can retry with a fresh SQLite open.
 */
export function BootstrapApp({
  bootstrap = bootstrapApplication,
  caseOpenDelayMs,
  decisionRevealDelayMs,
}: BootstrapAppProps) {
  const [view, setView] = useState<BootstrapViewState>(initialViewState);
  const inFlight = useRef<Promise<ApplicationBootstrapResult> | null>(null);
  const mounted = useRef(false);

  const start = useCallback((): void => {
    if (inFlight.current) return;
    setView(initialViewState);
    const pending = Promise.resolve().then(bootstrap);
    inFlight.current = pending;
    pending.then(
      (result) => {
        inFlight.current = null;
        if (mounted.current) {
          setView(Object.freeze({ status: "ready", result, error: null }));
        }
      },
      (error: unknown) => {
        inFlight.current = null;
        if (mounted.current) {
          setView(Object.freeze({ status: "error", result: null, error }));
        }
      },
    );
  }, [bootstrap]);

  useEffect(() => {
    mounted.current = true;
    start();
    return () => {
      mounted.current = false;
    };
  }, [start]);

  if (view.status === "loading") {
    return <StorageStartupScreen status="loading" />;
  }
  if (view.status === "error") {
    return <StorageStartupScreen status="error" error={view.error} onRetry={start} />;
  }

  return (
    <App
      profileEntry={view.result.profileEntry}
      storageMode={view.result.storageMode}
      caseOpenDelayMs={caseOpenDelayMs}
      decisionRevealDelayMs={decisionRevealDelayMs}
    />
  );
}
