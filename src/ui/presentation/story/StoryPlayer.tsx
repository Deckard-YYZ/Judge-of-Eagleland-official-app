import { getDiagnostics } from "../../../shared/diagnostics";
import { useEffect, useState, type CSSProperties } from "react";
import type { ContentAttributeView, ContentStoryView } from "../../../application/gameContentView";
import type { GameSessionView } from "../../../application/gameSessionView";
import type { StoryId } from "../../../content/schema";
import { useI18n, type MessageKey } from "../../i18n";
import { StoryBlocks } from "./StoryBlocks";
import { ActionInputPanel } from "./ActionInputPanel";
import { NarrationControls } from "../../narration/NarrationControls";
import "./story.css";

export type StoryCompletionReason = "completed" | "skipped";

export interface StoryPlayerProps {
  storyId: StoryId;
  story: Readonly<ContentStoryView>;
  sessionView: GameSessionView;
  attributes: Readonly<Record<string, ContentAttributeView>>;
  resumeStepId?: string | null;
  busy?: boolean;
  narrationReady?: boolean;
  completionError?: string | null;
  onComplete(reason: StoryCompletionReason): void | Promise<void>;
}

const effectLabelKeys = {
  blood: "story.effect.blood",
  fade: "story.effect.fade",
} as const satisfies Record<"blood" | "fade", MessageKey>;

/**
 * Ordinary playback remains local. A committed input checkpoint is a lower bound,
 * so localization and feedback updates cannot rewind already displayed text.
 */
export function StoryPlayer({
  storyId,
  story,
  sessionView,
  attributes,
  resumeStepId = null,
  busy = false,
  narrationReady = true,
  completionError = null,
  onComplete,
}: StoryPlayerProps) {
  const { formatNumber, t } = useI18n();
  const checkpointIndex = Math.max(
    0,
    story.steps.findIndex((entry) => entry.id === resumeStepId),
  );
  const [localStepIndex, setStepIndex] = useState(checkpointIndex);
  const stepIndex = Math.max(localStepIndex, checkpointIndex);
  const [finishedEffectKey, setFinishedEffectKey] = useState<string | null>(null);
  const [videoRetryFailed, setVideoRetryFailed] = useState(false);
  const step = story.steps[stepIndex];
  const effectKey = `${storyId}:${stepIndex}`;
  const effectFinished = finishedEffectKey === effectKey;

  useEffect(() => {
    setStepIndex(checkpointIndex);
    setFinishedEffectKey(null);
    setVideoRetryFailed(false);
  }, [storyId]);

  useEffect(() => {
    setVideoRetryFailed(false);

    if (step?.type !== "effect") {
      return;
    }

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const timerId = window.setTimeout(
      () => setFinishedEffectKey(effectKey),
      reduceMotion ? 0 : step.durationMs,
    );

    return () => window.clearTimeout(timerId);
  }, [effectKey, step]);

  if (!step) {
    return (
      <section className="story-player story-player--error" aria-labelledby="story-error-title">
        <p className="story-player__kicker">{t("story.errorKicker")}</p>
        <h2 id="story-error-title">{story.title}</h2>
        <p role="alert">{t("story.emptyDetail")}</p>
        <button
          className="story-button story-button--primary"
          type="button"
          disabled={busy}
          onClick={() => void onComplete("completed")}
        >
          {t(busy ? "story.saving" : "story.confirmContinue")}
        </button>
      </section>
    );
  }

  const atLastStep = stepIndex === story.steps.length - 1;
  const advance = (): void => {
    if (busy) {
      return;
    }

    if (atLastStep) {
      void onComplete("completed");
      return;
    }

    setStepIndex(Math.min(stepIndex + 1, story.steps.length - 1));
  };

  const canAdvance = step.type !== "effect" || effectFinished;

  return (
    <article
      className="story-player"
      aria-labelledby="story-player-title"
      aria-busy={busy}
      data-story-id={storyId}
      data-step-type={step.type}
    >
      <header className="story-player__header">
        <div>
          <p className="story-player__kicker">{t("story.kicker")}</p>
          <h2 id="story-player-title">{story.title}</h2>
        </div>
        <span
          className="story-player__progress"
          aria-label={t("story.progressAria", {
            current: formatNumber(stepIndex + 1),
            total: formatNumber(story.steps.length),
          })}
        >
          {formatNumber(stepIndex + 1, { minimumIntegerDigits: 2, useGrouping: false })} /{" "}
          {formatNumber(story.steps.length, { minimumIntegerDigits: 2, useGrouping: false })}
        </span>
      </header>

      <div className="story-player__stage" key={stepIndex}>
        {(step.type === "text" || step.type === "actionInput") && (
          <NarrationControls
            storyId={storyId}
            stepId={step.id}
            key={step.id}
            narration={step.narration}
            ready={narrationReady}
          />
        )}
        {step.type === "actionInput" ? (
          <ActionInputPanel
            sessionView={sessionView}
            storyId={storyId}
            step={step}
            attributes={attributes}
            busy={busy}
          />
        ) : null}
        {step.type === "text" ? <StoryBlocks blocks={step.blocks} /> : null}

        {step.type === "video" ? (
          <section className="story-video-fallback" aria-labelledby="story-video-title">
            <div className="story-video-fallback__frame" aria-hidden="true">
              <span>{t("story.videoUnavailableFrame")}</span>
            </div>
            <div className="story-video-fallback__notice">
              <p className="story-video-fallback__label">{t("story.videoUnavailableLabel")}</p>
              <h3 id="story-video-title">{t("story.videoFallbackTitle")}</h3>
              <p>{t("story.videoFallbackDetail")}</p>
              <button
                className="story-button story-button--secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  getDiagnostics().record({
                    source: "story",
                    event: "video.placeholder_retry",
                    data: { storyId, stepId: step.id, reason: "player_not_implemented" },
                  });
                  setVideoRetryFailed(true);
                }}
              >
                {t("story.videoRetry")}
              </button>
              {videoRetryFailed ? (
                <p className="story-video-fallback__retry" role="status" aria-live="polite">
                  {t("story.videoRetryFailed")}
                </p>
              ) : null}
            </div>
            <div className="story-video-fallback__copy">
              <p className="story-video-fallback__label">{t("story.videoFallbackLabel")}</p>
              <StoryBlocks blocks={step.fallbackBlocks} />
            </div>
          </section>
        ) : null}

        {step.type === "effect" ? (
          <section className={`story-effect story-effect--${step.effect}`} aria-live="polite">
            <div
              className="story-effect__visual"
              style={{ "--story-effect-duration": `${step.durationMs}ms` } as CSSProperties}
              aria-hidden="true"
            />
            <p>
              {effectFinished
                ? t("story.effectFinished", { effect: t(effectLabelKeys[step.effect]) })
                : t(effectLabelKeys[step.effect])}
            </p>
          </section>
        ) : null}
      </div>

      {completionError ? (
        <p className="story-player__error" role="alert">
          {t("story.saveFailed", { message: completionError })}
        </p>
      ) : null}

      <footer className="story-player__actions">
        {story.skippable && !story.steps.some((entry) => entry.type === "actionInput") ? (
          <button
            className="story-button story-button--quiet"
            type="button"
            disabled={busy}
            onClick={() => void onComplete("skipped")}
          >
            {t("story.skip")}
          </button>
        ) : (
          <span className="story-player__required">{t("story.required")}</span>
        )}

        {step.type !== "actionInput" ? (
          <button
            className="story-button story-button--primary"
            type="button"
            disabled={busy || !canAdvance}
            onClick={advance}
          >
            {t(
              busy
                ? "story.saving"
                : step.type === "effect" && !effectFinished
                  ? "story.effectRunning"
                  : atLastStep
                    ? "story.complete"
                    : "story.continue",
            )}
          </button>
        ) : null}
      </footer>
    </article>
  );
}
