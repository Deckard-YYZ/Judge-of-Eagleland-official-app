import { useEffect, useRef, useState } from "react";
import type { GameSessionView } from "../../../application/gameSessionView";
import "./feedback.css";

const FEEDBACK_DURATION_MS = 4_200;

type DisplayChange = Readonly<{
  label: string;
  after: number;
  actualDelta: number;
}>;

type FeedbackNotice = Readonly<{
  id: number;
  changes: readonly DisplayChange[];
}>;

export interface FeedbackLayerProps {
  sessionView: GameSessionView;
}

const signedDelta = (delta: number): string => (delta > 0 ? `+${delta}` : String(delta));

const deltaTone = (delta: number): "positive" | "negative" | "neutral" => {
  if (delta > 0) {
    return "positive";
  }

  if (delta < 0) {
    return "negative";
  }

  return "neutral";
};

/**
 * Displays disposable, post-commit attribute feedback without participating in
 * command dispatch, game-state reads or resolution evaluation.
 */
export function FeedbackLayer({ sessionView }: FeedbackLayerProps) {
  const [queue, setQueue] = useState<readonly FeedbackNotice[]>([]);
  const nextNoticeId = useRef(0);
  const activeNotice = queue[0];

  useEffect(() => {
    setQueue([]);
    nextNoticeId.current = 0;
    const unsubscribe = sessionView.subscribeFeedback((feedback) => {
      try {
        const notices: FeedbackNotice[] = [];

        for (const request of feedback) {
          if (request.type !== "attributeFeedback" || request.changes.length === 0) {
            continue;
          }

          // Feedback arrives only after a successful save. Snapshot the committed
          // facts supplied by Application; never replay a resolution template here.
          notices.push({
            id: nextNoticeId.current++,
            changes: request.changes.map(({ label, after, actualDelta }) => ({
              label,
              after,
              actualDelta,
            })),
          });
        }

        if (notices.length > 0) {
          setQueue((currentQueue) => [...currentQueue, ...notices]);
        }
      } catch {
        // Transient feedback is disposable presentation. Dropping it must never
        // dispatch a command or alter the already-committed session state.
      }
    });

    return unsubscribe;
  }, [sessionView]);

  useEffect(() => {
    if (!activeNotice) {
      return;
    }

    const noticeId = activeNotice.id;
    const timeoutId = window.setTimeout(() => {
      setQueue((currentQueue) =>
        currentQueue[0]?.id === noticeId ? currentQueue.slice(1) : currentQueue,
      );
    }, FEEDBACK_DURATION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [activeNotice]);

  return (
    <aside
      className="feedback-layer"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label="属性变化反馈"
    >
      {activeNotice ? (
        <section className="feedback-notice" key={activeNotice.id}>
          <p className="feedback-notice__title">属性已更新</p>
          <dl className="feedback-notice__changes">
            {activeNotice.changes.map((change, index) => (
              <div className="feedback-notice__change" key={`${change.label}-${index}`}>
                <dt>{change.label}</dt>
                <dd>
                  <span className="feedback-notice__after">当前 {change.after}</span>
                  <span
                    className={`feedback-notice__delta feedback-notice__delta--${deltaTone(
                      change.actualDelta,
                    )}`}
                    aria-label={`实际变化 ${signedDelta(change.actualDelta)}`}
                  >
                    {signedDelta(change.actualDelta)}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </aside>
  );
}
