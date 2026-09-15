import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { GameSessionView } from "../../../application/gameSessionView";
import { useI18n } from "../../i18n";
import "./feedback.css";

const FEEDBACK_DURATION_MS = 4_200;

type DisplayChange = Readonly<{
  attributeId: string;
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
  const { formatNumber, t } = useI18n();
  const sessionSnapshot = useSyncExternalStore(sessionView.subscribe, sessionView.getSnapshot);
  const [queue, setQueue] = useState<readonly FeedbackNotice[]>([]);
  const nextNoticeId = useRef(0);
  const activeNotice = queue[0];
  const signedDelta = (delta: number): string =>
    formatNumber(delta, { signDisplay: delta === 0 ? "auto" : "always" });

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
            changes: request.changes.map(({ attributeId, after, actualDelta }) => ({
              attributeId,
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
      aria-label={t("feedback.aria")}
    >
      {activeNotice ? (
        <section className="feedback-notice" key={activeNotice.id}>
          <p className="feedback-notice__title">{t("feedback.title")}</p>
          <dl className="feedback-notice__changes">
            {activeNotice.changes.map((change, index) => (
              <div className="feedback-notice__change" key={`${change.attributeId}-${index}`}>
                <dt>
                  {sessionSnapshot.content?.attributes[change.attributeId]?.label ??
                    change.attributeId}
                </dt>
                <dd>
                  <span className="feedback-notice__after">
                    {t("feedback.current", { value: formatNumber(change.after) })}
                  </span>
                  <span
                    className={`feedback-notice__delta feedback-notice__delta--${deltaTone(
                      change.actualDelta,
                    )}`}
                    aria-label={t("feedback.deltaAria", {
                      delta: signedDelta(change.actualDelta),
                    })}
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
