import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { GameSessionView } from "../application/gameSessionView";
import type { LocalProfileSummary, ProfileEntry } from "../application/profileEntry";
import { InterfaceSettings } from "./InterfaceSettings";
import { CaseWorkspace } from "./case";
import { I18nProvider, useI18n } from "./i18n";
import { FeedbackLayer } from "./presentation/feedback";
import { StoryOverlay } from "./presentation/story";
import { ProfilePage } from "./profile/ProfilePage";
import { AppShell } from "./shell";
import { WorkspaceStudy } from "./workspace-study/WorkspaceStudy";
import { applyThemeMode, readInitialThemeMode, type UiThemeMode } from "./theme";

export interface AppProps {
  profileEntry: ProfileEntry;
  /** Tells the profile surface whether this is the persistent desktop path or preview memory. */
  storageMode?: "sqlite" | "memory-preview";
  caseOpenDelayMs?: number;
  decisionRevealDelayMs?: number;
}

interface AuthenticatedWorkspaceProps {
  profile: Readonly<LocalProfileSummary>;
  session: GameSessionView;
  themeMode: UiThemeMode;
  caseOpenDelayMs?: number;
  decisionRevealDelayMs?: number;
  onThemeChange(mode: UiThemeMode): void;
  onExit: () => void;
}

function AuthenticatedWorkspace({
  profile,
  session,
  themeMode,
  caseOpenDelayMs,
  decisionRevealDelayMs,
  onThemeChange,
  onExit,
}: AuthenticatedWorkspaceProps) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [dismissedEnding, setDismissedEnding] = useState<{
    session: GameSessionView;
    endingId: string;
  } | null>(null);
  const endingId = snapshot.state?.phase.type === "ended" ? snapshot.state.phase.endingId : null;
  const endingOpen =
    endingId !== null &&
    !(dismissedEnding?.session === session && dismissedEnding.endingId === endingId);
  // Recovery takes precedence over modal stories so its action remains focusable.
  const recovering = snapshot.status === "needsReload" || snapshot.status === "error";
  const overlayActive =
    !recovering &&
    Boolean(
      snapshot.state?.pendingStoryIds[0] || snapshot.state?.phase.type === "ending" || endingOpen,
    );
  const previousOverlayActive = useRef(overlayActive);

  useEffect(() => {
    const overlayClosed = previousOverlayActive.current && !overlayActive;
    previousOverlayActive.current = overlayActive;

    if (overlayClosed) {
      document.getElementById("case-workspace")?.focus();
    }
  }, [overlayActive]);

  return (
    <>
      <AppShell
        profile={profile}
        snapshot={snapshot}
        modalActive={overlayActive}
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        onSelectCase={session.selectCase}
        onExit={onExit}
      >
        <CaseWorkspace
          snapshot={snapshot}
          dispatch={session.dispatch}
          reload={session.reload}
          caseOpenDelayMs={caseOpenDelayMs}
          decisionRevealDelayMs={decisionRevealDelayMs}
        />
      </AppShell>
      <FeedbackLayer sessionView={session} />
      {!recovering && (
        <StoryOverlay
          settings={<InterfaceSettings themeMode={themeMode} onThemeChange={onThemeChange} />}
          sessionView={session}
          snapshot={snapshot}
          endingOpen={endingOpen}
          onCloseEnding={() => {
            // Closing the final presentation is local navigation only. The ended
            // GameState stays authoritative and all case commands remain blocked.
            if (endingId) {
              setDismissedEnding({ session, endingId });
            }
          }}
        />
      )}
    </>
  );
}

/** App owns only the authenticated UI reference; exiting never writes GameState. */
function LocalizedApp({
  profileEntry,
  storageMode = "memory-preview",
  caseOpenDelayMs,
  decisionRevealDelayMs,
}: AppProps) {
  const { locale } = useI18n();
  const [themeMode, setThemeMode] = useState<UiThemeMode>(readInitialThemeMode);
  const [profileAvatarUrls, setProfileAvatarUrls] = useState<Readonly<Record<string, string>>>({});
  const ownedAvatarUrls = useRef(new Set<string>());
  const [active, setActive] = useState<{
    profile: Readonly<LocalProfileSummary>;
    session: GameSessionView;
  } | null>(null);

  useEffect(() => {
    if (active) void active.session.setLocale(locale);
  }, [active, locale]);

  useLayoutEffect(() => {
    // The document attribute is the single theme boundary shared by the shell and portalled overlays.
    applyThemeMode(themeMode);
  }, [themeMode]);

  useEffect(
    () => () => {
      // Avatar blobs never cross the UI boundary. App owns the copies that
      // survive ProfilePage unmounts and releases all of them on teardown.
      for (const objectUrl of ownedAvatarUrls.current) {
        URL.revokeObjectURL(objectUrl);
      }
      ownedAvatarUrls.current.clear();
    },
    [],
  );

  const authenticate = (
    profile: Readonly<LocalProfileSummary>,
    session: GameSessionView,
    avatarFile?: File,
  ): void => {
    if (avatarFile) {
      const objectUrl = URL.createObjectURL(avatarFile);
      ownedAvatarUrls.current.add(objectUrl);
      setProfileAvatarUrls((current) => ({ ...current, [profile.profileId]: objectUrl }));
    }
    // Locale is UI state. Loading a presentation never dispatches or writes the save.
    void session.setLocale(locale);
    setActive({ profile, session });
  };

  const previewDirection = new URLSearchParams(window.location.search).get("uiPreview");
  if (previewDirection === "judicial" || previewDirection === "terminal") {
    return (
      <WorkspaceStudy
        initialDirection={previewDirection}
        themeMode={themeMode}
        onThemeChange={setThemeMode}
      />
    );
  }

  if (!active) {
    return (
      <ProfilePage
        entry={profileEntry}
        storageMode={storageMode}
        themeMode={themeMode}
        profileAvatarUrls={profileAvatarUrls}
        onThemeChange={setThemeMode}
        onAuthenticated={authenticate}
      />
    );
  }

  return (
    <AuthenticatedWorkspace
      profile={active.profile}
      session={active.session}
      themeMode={themeMode}
      caseOpenDelayMs={caseOpenDelayMs}
      decisionRevealDelayMs={decisionRevealDelayMs}
      onThemeChange={setThemeMode}
      onExit={() => setActive(null)}
    />
  );
}

/** The formal App root owns locale before authentication and across all portalled UI. */
export function App(props: AppProps) {
  return (
    <I18nProvider>
      <LocalizedApp {...props} />
    </I18nProvider>
  );
}
