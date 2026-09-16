import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type {
  GameSessionView,
  GameSessionViewSnapshot,
} from "../../../application/gameSessionView";
import type { GameSessionErrorCode } from "../../../application/gameSession";
import { LocaleSwitch } from "../../LocaleSwitch";
import { translateSessionError, useI18n } from "../../i18n";
import { EndingView } from "./EndingView";
import { StoryPlayer, type StoryCompletionReason } from "./StoryPlayer";
import "./story.css";

export interface StoryOverlayProps {
  sessionView: GameSessionView;
  snapshot: GameSessionViewSnapshot;
  endingOpen: boolean;
  onCloseEnding(): void;
}

let nextSessionViewKey = 1;
const sessionViewKeys = new WeakMap<GameSessionView, number>();

const getSessionViewKey = (sessionView: GameSessionView): number => {
  const existing = sessionViewKeys.get(sessionView);
  if (existing !== undefined) {
    return existing;
  }

  const key = nextSessionViewKey++;
  sessionViewKeys.set(sessionView, key);
  return key;
};

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

interface ModalFrameProps {
  identity: string;
  onDismiss?: () => void;
  children: React.ReactNode;
}

function ModalFrame({ identity, onDismiss, children }: ModalFrameProps) {
  const { t } = useI18n();
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    frameRef.current?.focus();
  }, [identity]);

  useEffect(() => {
    const ownerDocument = frameRef.current?.ownerDocument;
    if (!ownerDocument) {
      return;
    }

    const previousOverflow = ownerDocument.body.style.overflow;
    ownerDocument.body.style.overflow = "hidden";
    return () => {
      ownerDocument.body.style.overflow = previousOverflow;
    };
  }, []);

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape" && onDismiss) {
      event.preventDefault();
      onDismiss();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(focusableSelector),
    ).filter((element) => element.getAttribute("aria-hidden") !== "true");

    if (focusable.length === 0) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === event.currentTarget)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="story-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("story.dialogAria")}
    >
      <div className="story-overlay__frame" ref={frameRef} tabIndex={-1} onKeyDown={trapFocus}>
        <div className="story-overlay__toolbar">
          <LocaleSwitch />
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Session-aware presentation wall. Playback uses committed state; completion and
 * action inputs always return through the application command boundary.
 */
export function StoryOverlay({
  sessionView,
  snapshot,
  endingOpen,
  onCloseEnding,
}: StoryOverlayProps) {
  const { t } = useI18n();
  const [submitting, setSubmitting] = useState(false);
  const [completionError, setCompletionError] = useState<
    GameSessionErrorCode | "unexpected" | null
  >(null);
  const operationVersion = useRef(0);
  const submittingRef = useRef(false);
  const state = snapshot.state;
  const content = snapshot.content;
  const currentStoryId = state?.pendingStoryIds[0] ?? null;
  const sessionKey = getSessionViewKey(sessionView);
  const saveIdentity = `${snapshot.envelope?.profileId}:${snapshot.envelope?.saveId}`;

  useEffect(() => {
    operationVersion.current += 1;
    submittingRef.current = false;
    setSubmitting(false);
    setCompletionError(null);

    return () => {
      // Invalidates any promise returned by the old Profile/session before it can update this UI.
      operationVersion.current += 1;
    };
  }, [currentStoryId, sessionView, saveIdentity]);

  const completeStory = useCallback(
    async (_reason: StoryCompletionReason): Promise<void> => {
      if (!currentStoryId || snapshot.status !== "ready" || submittingRef.current) {
        return;
      }

      const storyIdAtDispatch = currentStoryId;
      const sessionAtDispatch = sessionView;
      const versionAtDispatch = ++operationVersion.current;
      submittingRef.current = true;
      setSubmitting(true);
      setCompletionError(null);

      // Persistence boundary: dispatch only the committed queue head. The UI never
      // removes a story optimistically or derives another story ID after this await.
      let result: Awaited<ReturnType<GameSessionView["dispatch"]>>;
      try {
        result = await sessionAtDispatch.dispatch({
          type: "completeStory",
          storyId: storyIdAtDispatch,
        });
      } catch (error) {
        if (operationVersion.current !== versionAtDispatch) {
          return;
        }

        submittingRef.current = false;
        setSubmitting(false);
        setCompletionError("unexpected");
        return;
      }

      if (operationVersion.current !== versionAtDispatch) {
        return;
      }

      submittingRef.current = false;
      setSubmitting(false);
      if (!result.ok) {
        setCompletionError(result.code);
      }
    },
    [currentStoryId, sessionView, snapshot.status],
  );

  if (!state || !content) {
    // idle/loading/error snapshots have no committed story or ending to present.
    return null;
  }

  const completionErrorMessage = completionError
    ? completionError === "unexpected"
      ? t("story.completeUnexpectedError")
      : translateSessionError(t, completionError)
    : snapshot.error
      ? translateSessionError(t, snapshot.error.code)
      : null;

  if (currentStoryId) {
    const story = content.stories[currentStoryId];
    const identity = `${sessionKey}:${saveIdentity}:story:${currentStoryId}`;

    return (
      <ModalFrame identity={identity}>
        {story ? (
          <StoryPlayer
            key={identity}
            storyId={currentStoryId}
            story={story}
            sessionView={sessionView}
            attributes={content.attributes}
            resumeStepId={
              state.storyCheckpoint?.storyId === currentStoryId
                ? state.storyCheckpoint.resumeStepId
                : null
            }
            busy={submitting || snapshot.status !== "ready"}
            completionError={completionErrorMessage}
            onComplete={completeStory}
          />
        ) : (
          <section
            className="story-player story-player--error"
            aria-labelledby="missing-story-title"
          >
            <p className="story-player__kicker">{t("story.errorKicker")}</p>
            <h2 id="missing-story-title">{t("story.missingTitle")}</h2>
            <p role="alert">{t("story.missingDetail")}</p>
            {completionErrorMessage ? (
              <p className="story-player__error" role="alert">
                {completionErrorMessage}
              </p>
            ) : null}
            <button
              className="story-button story-button--primary"
              type="button"
              disabled={submitting || snapshot.status !== "ready"}
              onClick={() => void completeStory("completed")}
            >
              {t(
                submitting || snapshot.status === "saving"
                  ? "story.saving"
                  : "story.confirmContinue",
              )}
            </button>
          </section>
        )}
      </ModalFrame>
    );
  }

  if (state.phase.type === "ended") {
    if (!endingOpen) {
      return null;
    }

    const ending = content.endings[state.phase.endingId];
    const identity = `${sessionKey}:ending:${state.phase.endingId}`;

    return (
      <ModalFrame identity={identity} onDismiss={onCloseEnding}>
        <EndingView
          endingId={state.phase.endingId}
          title={ending?.title ?? t("story.unnamedEnding")}
          onReturnToArchive={onCloseEnding}
        />
      </ModalFrame>
    );
  }

  if (state.phase.type === "ending") {
    return (
      <ModalFrame identity={`${sessionKey}:ending-pending:${state.phase.endingId}`}>
        <section
          className="story-player story-player--error"
          aria-labelledby="ending-pending-title"
        >
          <p className="story-player__kicker">{t("story.endingPendingKicker")}</p>
          <h2 id="ending-pending-title">{t("story.endingPendingTitle")}</h2>
          <p role="status">{t("story.endingPendingDetail")}</p>
          {snapshot.error ? (
            <p className="story-player__error" role="alert">
              {translateSessionError(t, snapshot.error.code)}
            </p>
          ) : null}
        </section>
      </ModalFrame>
    );
  }

  return null;
}
