import type { ReactNode } from "react";
import type { GameSessionViewSnapshot } from "../../application/gameSessionView";
import type { LocalProfileSummary } from "../../application/profileEntry";
import type { CaseId } from "../../content/schema";
import { LocaleSwitch } from "../LocaleSwitch";
import { ThemeSwitch } from "../ThemeSwitch";
import { translateSessionError, useI18n, type MessageKey } from "../i18n";
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

const sessionStatusKeys = {
  idle: "shell.status.idle",
  loading: "shell.status.loading",
  ready: "shell.status.ready",
  saving: "shell.status.saving",
  needsReload: "shell.status.needsReload",
  error: "shell.status.error",
} as const satisfies Record<GameSessionViewSnapshot["status"], MessageKey>;

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
  const { t } = useI18n();
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
          aria-label={t("shell.workspaceLabel")}
        >
          <span className="wordmark__seal" aria-hidden="true">
            {t("brand.seal")}
          </span>
          <span>
            <strong>{t("brand.name")}</strong>
            <small>{t("brand.office")}</small>
          </span>
        </a>

        <div className="app-shell__account">
          <LocaleSwitch />
          <ThemeSwitch mode={themeMode} onChange={onThemeChange} />
          <span className={`app-shell__status app-shell__status--${snapshot.status}`}>
            {t(sessionStatusKeys[snapshot.status])}
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
            {t("shell.exit")}
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
              {translateSessionError(t, snapshot.error.code)}
            </p>
          ) : null}
          {snapshot.localizationError ? (
            <p className="app-shell__error" role="alert">
              {t(
                snapshot.localizationStatus === "fallback"
                  ? "content.localizationFallback"
                  : "content.localizationFailed",
              )}
            </p>
          ) : null}
          {ioLocked ? (
            <p className="sr-only" role="status" aria-live="polite">
              {t(snapshot.status === "loading" ? "shell.lockedLoading" : "shell.lockedSaving")}
            </p>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
