import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { GameSessionView } from "../application/gameSessionView";
import type { LocalProfileSummary, ProfileEntry } from "../application/profileEntry";
import { CaseReader } from "./case";
import { FeedbackLayer } from "./presentation/feedback";
import { StoryOverlay } from "./presentation/story";
import { ProfilePage } from "./profile/ProfilePage";
import { AppShell } from "./shell";
import { applyThemeMode, readInitialThemeMode, type UiThemeMode } from "./theme";

export interface AppProps {
  profileEntry: ProfileEntry;
}

interface AuthenticatedWorkspaceProps {
  profile: Readonly<LocalProfileSummary>;
  session: GameSessionView;
  themeMode: UiThemeMode;
  onThemeChange(mode: UiThemeMode): void;
  onExit: () => void;
}

function AuthenticatedWorkspace({
  profile,
  session,
  themeMode,
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
  const overlayActive = Boolean(
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
        <CaseReader snapshot={snapshot} dispatch={session.dispatch} />
      </AppShell>
      <FeedbackLayer sessionView={session} />
      <StoryOverlay
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
    </>
  );
}

/** App owns only the authenticated UI reference; exiting never writes GameState. */
export function App({ profileEntry }: AppProps) {
  const [themeMode, setThemeMode] = useState<UiThemeMode>(readInitialThemeMode);
  const [active, setActive] = useState<{
    profile: Readonly<LocalProfileSummary>;
    session: GameSessionView;
  } | null>(null);

  useLayoutEffect(() => {
    // The document attribute is the single theme boundary shared by the shell and portalled overlays.
    applyThemeMode(themeMode);
  }, [themeMode]);

  if (!active) {
    return (
      <ProfilePage
        entry={profileEntry}
        themeMode={themeMode}
        onThemeChange={setThemeMode}
        onAuthenticated={(profile, session) => setActive({ profile, session })}
      />
    );
  }

  return (
    <AuthenticatedWorkspace
      profile={active.profile}
      session={active.session}
      themeMode={themeMode}
      onThemeChange={setThemeMode}
      onExit={() => setActive(null)}
    />
  );
}
