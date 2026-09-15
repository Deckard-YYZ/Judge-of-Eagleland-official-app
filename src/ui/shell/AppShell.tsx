import type { ReactNode } from "react";
import type { GameSessionViewSnapshot } from "../../application/gameSessionView";
import type { LocalProfileSummary } from "../../application/profileEntry";
import type { CaseId } from "../../content/schema";
import { ThemeSwitch } from "../ThemeSwitch";
import type { UiThemeMode } from "../theme";
import { Sidebar } from "./Sidebar";
import "./shell.css";

export interface AppShellProps {
  profile: Readonly<LocalProfileSummary>;
  snapshot: GameSessionViewSnapshot;
  modalActive?: boolean;
  themeMode: UiThemeMode;
  onThemeChange(mode: UiThemeMode): void;
  onSelectCase(caseId: CaseId): void;
  onExit(): void;
  children: ReactNode;
}

const sessionStatusLabel = {
  idle: "等待载入",
  loading: "正在载入",
  ready: "档案就绪",
  saving: "正在归档",
  needsReload: "需要重新载入",
  error: "载入失败",
} as const;

export function AppShell({
  profile,
  snapshot,
  modalActive = false,
  themeMode,
  onThemeChange,
  onSelectCase,
  onExit,
  children,
}: AppShellProps) {
  const ioLocked = snapshot.status === "loading" || snapshot.status === "saving";
  const interactionLocked = ioLocked || modalActive;

  const exit = (): void => {
    // Keep the synchronous guard in addition to disabled so programmatic clicks cannot exit mid-I/O.
    if (!interactionLocked) {
      onExit();
    }
  };

  return (
    <div
      className="app-shell"
      inert={modalActive ? true : undefined}
      aria-hidden={modalActive ? true : undefined}
    >
      <header className="app-shell__bar">
        <a
          className="wordmark wordmark--compact"
          href="#case-workspace"
          aria-label="鹰国法官工作区"
        >
          <span className="wordmark__seal" aria-hidden="true">
            衡
          </span>
          <span>
            <strong>鹰国法官</strong>
            <small>司法档案处</small>
          </span>
        </a>

        <div className="app-shell__account">
          <ThemeSwitch mode={themeMode} onChange={onThemeChange} />
          <span className={`app-shell__status app-shell__status--${snapshot.status}`}>
            {sessionStatusLabel[snapshot.status]}
          </span>
          <span className="app-shell__profile" title={profile.displayName}>
            {profile.displayName}
          </span>
          <button
            className="button button--quiet"
            type="button"
            onClick={exit}
            disabled={interactionLocked}
          >
            退出档案
          </button>
        </div>
      </header>

      <div className="app-shell__workspace">
        <Sidebar
          snapshot={snapshot}
          interactionLocked={interactionLocked}
          onSelectCase={onSelectCase}
        />
        <main className="app-shell__main" id="case-workspace" tabIndex={-1}>
          {snapshot.error ? (
            <p className="app-shell__error" role="alert">
              {snapshot.error.message}
            </p>
          ) : null}
          {ioLocked ? (
            <p className="sr-only" role="status" aria-live="polite">
              {snapshot.status === "loading"
                ? "正在载入档案，暂时无法切换文档或退出。"
                : "正在保存裁定，暂时无法切换文档或退出。"}
            </p>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
