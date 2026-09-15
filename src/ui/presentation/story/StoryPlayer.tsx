import { useEffect, useState, type CSSProperties } from "react";
import type { StoryDefinition, StoryId } from "../../../content/schema";
import { StoryBlocks } from "./StoryBlocks";
import "./story.css";

export type StoryCompletionReason = "completed" | "skipped";

export interface StoryPlayerProps {
  storyId: StoryId;
  story: Readonly<StoryDefinition>;
  busy?: boolean;
  completionError?: string | null;
  onComplete(reason: StoryCompletionReason): void | Promise<void>;
}

const effectLabel = {
  blood: "血色掠过卷宗",
  fade: "画面渐暗",
} as const;

/**
 * Plays one persisted story unit. The step cursor is intentionally local: only
 * completing the whole StoryDefinition is allowed to cross the save boundary.
 */
export function StoryPlayer({
  storyId,
  story,
  busy = false,
  completionError = null,
  onComplete,
}: StoryPlayerProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [finishedEffectKey, setFinishedEffectKey] = useState<string | null>(null);
  const [videoRetryMessage, setVideoRetryMessage] = useState<string | null>(null);
  const step = story.steps[stepIndex];
  const effectKey = `${storyId}:${stepIndex}`;
  const effectFinished = finishedEffectKey === effectKey;

  useEffect(() => {
    setStepIndex(0);
    setFinishedEffectKey(null);
    setVideoRetryMessage(null);
  }, [storyId]);

  useEffect(() => {
    setVideoRetryMessage(null);

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
        <p className="story-player__kicker">演出内容异常</p>
        <h2 id="story-error-title">{story.title}</h2>
        <p role="alert">当前剧情没有可显示的步骤。可以确认后继续，不会改变案件规则结果。</p>
        <button
          className="story-button story-button--primary"
          type="button"
          disabled={busy}
          onClick={() => void onComplete("completed")}
        >
          {busy ? "正在保存…" : "确认并继续"}
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

    setStepIndex((current) => Math.min(current + 1, story.steps.length - 1));
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
          <p className="story-player__kicker">Important story</p>
          <h2 id="story-player-title">{story.title}</h2>
        </div>
        <span
          className="story-player__progress"
          aria-label={`第 ${stepIndex + 1} 步，共 ${story.steps.length} 步`}
        >
          {String(stepIndex + 1).padStart(2, "0")} / {String(story.steps.length).padStart(2, "0")}
        </span>
      </header>

      <div className="story-player__stage">
        {step.type === "text" ? <StoryBlocks blocks={step.blocks} /> : null}

        {step.type === "video" ? (
          <section className="story-video-fallback" aria-labelledby="story-video-title">
            <div className="story-video-fallback__frame" aria-hidden="true">
              <span>VIDEO UNAVAILABLE</span>
            </div>
            <div className="story-video-fallback__notice">
              <p className="story-video-fallback__label">影像暂不可用</p>
              <h3 id="story-video-title">已切换到替代叙事</h3>
              <p>当前版本尚未接入受控媒体解析器，因此不会尝试读取内容包路径或任意本地文件。</p>
              <button
                className="story-button story-button--secondary"
                type="button"
                disabled={busy}
                onClick={() =>
                  setVideoRetryMessage("仍无法播放：媒体解析器尚未接入。请阅读下方替代叙事。")
                }
              >
                重试影像（占位）
              </button>
              {videoRetryMessage ? (
                <p className="story-video-fallback__retry" role="status" aria-live="polite">
                  {videoRetryMessage}
                </p>
              ) : null}
            </div>
            <div className="story-video-fallback__copy">
              <p className="story-video-fallback__label">替代叙事</p>
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
                ? `${effectLabel[step.effect]}，演出完成。`
                : effectLabel[step.effect]}
            </p>
          </section>
        ) : null}
      </div>

      {completionError ? (
        <p className="story-player__error" role="alert">
          保存失败：{completionError}
        </p>
      ) : null}

      <footer className="story-player__actions">
        {story.skippable ? (
          <button
            className="story-button story-button--quiet"
            type="button"
            disabled={busy}
            onClick={() => void onComplete("skipped")}
          >
            跳过整段剧情
          </button>
        ) : (
          <span className="story-player__required">本段剧情不可跳过</span>
        )}

        <button
          className="story-button story-button--primary"
          type="button"
          disabled={busy || !canAdvance}
          onClick={advance}
        >
          {busy
            ? "正在保存…"
            : step.type === "effect" && !effectFinished
              ? "演出进行中…"
              : atLastStep
                ? "完成剧情"
                : "继续"}
        </button>
      </footer>
    </article>
  );
}
