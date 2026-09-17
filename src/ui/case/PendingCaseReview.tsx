import { useCallback, useEffect, useRef, useState } from "react";
import type { GameSessionView } from "../../application/gameSessionView";
import { translateSessionError, useI18n } from "../i18n";
import type { GameSessionErrorCode } from "../../application/gameSession";
import { observeReviewVisibility } from "./observeReviewVisibility";

interface PendingCaseReviewProps {
  caseId: string;
  dispatch: GameSessionView["dispatch"];
  disabled: boolean;
  onThinkingStarted(startedAt: number): void;
}

/** Mounted per case. An unsuccessful attempt requires an explicit retry. */
export function PendingCaseReview({
  caseId,
  dispatch,
  disabled,
  onThinkingStarted,
}: PendingCaseReviewProps) {
  const { t } = useI18n();
  const gate = useRef<HTMLDivElement>(null);
  const live = useRef(false);
  const attempted = useRef(false);
  const inFlight = useRef(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<GameSessionErrorCode | "unexpected" | null>(null);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const start = useCallback(async () => {
    if (!live.current || disabled || inFlight.current) return;
    attempted.current = true;
    inFlight.current = true;
    setStarting(true);
    setError(null);
    onThinkingStarted(Date.now());
    try {
      const result = await dispatch({ type: "startCase", caseId });
      if (live.current && !result.ok) setError(result.code);
    } catch {
      if (live.current) setError("unexpected");
    } finally {
      inFlight.current = false;
      if (live.current) setStarting(false);
    }
  }, [caseId, disabled, dispatch, onThinkingStarted]);

  useEffect(() => {
    if (disabled || attempted.current || !gate.current) return;
    return observeReviewVisibility(gate.current, () => {
      if (!attempted.current) void start();
    });
  }, [disabled, start]);

  return (
    <section className="pending-case-review" aria-busy={starting}>
      <div className="decision-reveal" ref={gate}>
        {error ? (
          <div className="case-reader__notice case-reader__notice--error">
            <p role="alert">
              {error === "unexpected" ? t("decision.startFailed") : translateSessionError(t, error)}
            </p>
            <button
              className="button button--secondary"
              type="button"
              disabled={disabled || starting}
              onClick={() => void start()}
            >
              {t("decision.retryStart")}
            </button>
          </div>
        ) : (
          <div
            className={`decision-thinking decision-thinking--${starting ? "thinking" : "waiting"}`}
            role="status"
          >
            <span className="decision-thinking__label">
              {t(starting ? "decision.thinking" : "decision.waiting")}
            </span>
            {starting && (
              <span className="decision-thinking__dots" aria-label={t("decision.thinkingAria")}>
                <i />
                <i />
                <i />
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
