import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type {
  GameSessionView,
  GameSessionViewSnapshot,
} from "../../../application/gameSessionView";
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
    <div className="story-overlay" role="dialog" aria-modal="true" aria-label="重要剧情">
      <div className="story-overlay__frame" ref={frameRef} tabIndex={-1} onKeyDown={trapFocus}>
        {children}
      </div>
    </div>
  );
}

/**
 * Session-aware presentation wall. It consumes all six snapshot variants but
 * sends only the head story ID back through the application command boundary.
 */
export function StoryOverlay({
  sessionView,
  snapshot,
  endingOpen,
  onCloseEnding,
}: StoryOverlayProps) {
  const [submitting, setSubmitting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const operationVersion = useRef(0);
  const submittingRef = useRef(false);
  const state = snapshot.state;
  const content = snapshot.content;
  const currentStoryId = state?.pendingStoryIds[0] ?? null;
  const sessionKey = getSessionViewKey(sessionView);

  useEffect(() => {
    operationVersion.current += 1;
    submittingRef.current = false;
    setSubmitting(false);
    setCompletionError(null);

    return () => {
      // Invalidates any promise returned by the old Profile/session before it can update this UI.
      operationVersion.current += 1;
    };
  }, [currentStoryId, sessionView]);

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
        setCompletionError(
          error instanceof Error ? error.message : "剧情完成操作未能提交。请重试。",
        );
        return;
      }

      if (operationVersion.current !== versionAtDispatch) {
        return;
      }

      submittingRef.current = false;
      setSubmitting(false);
      if (!result.ok) {
        setCompletionError(result.message);
      }
    },
    [currentStoryId, sessionView, snapshot.status],
  );

  if (!state || !content) {
    // idle/loading/error snapshots have no committed story or ending to present.
    return null;
  }

  if (currentStoryId) {
    const story = content.stories[currentStoryId];
    const identity = `${sessionKey}:story:${currentStoryId}`;

    return (
      <ModalFrame identity={identity}>
        {story ? (
          <StoryPlayer
            key={identity}
            storyId={currentStoryId}
            story={story}
            busy={submitting || snapshot.status === "saving"}
            completionError={completionError ?? snapshot.error?.message}
            onComplete={completeStory}
          />
        ) : (
          <section
            className="story-player story-player--error"
            aria-labelledby="missing-story-title"
          >
            <p className="story-player__kicker">演出内容异常</p>
            <h2 id="missing-story-title">剧情内容无法载入</h2>
            <p role="alert">
              队列中的剧情未在当前内容版本中找到。确认后可以继续，不会重新计算案件结果。
            </p>
            {completionError || snapshot.error ? (
              <p className="story-player__error" role="alert">
                {completionError ?? snapshot.error?.message}
              </p>
            ) : null}
            <button
              className="story-button story-button--primary"
              type="button"
              disabled={submitting || snapshot.status !== "ready"}
              onClick={() => void completeStory("completed")}
            >
              {submitting || snapshot.status === "saving" ? "正在保存…" : "确认并继续"}
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
          title={ending?.title ?? "未命名结局"}
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
          <p className="story-player__kicker">Final archive</p>
          <h2 id="ending-pending-title">结局正在归档</h2>
          <p role="status">结局阶段尚未完成，主工作区将保持锁定。请重新载入档案以恢复演出队列。</p>
          {snapshot.error ? (
            <p className="story-player__error" role="alert">
              {snapshot.error.message}
            </p>
          ) : null}
        </section>
      </ModalFrame>
    );
  }

  return null;
}
