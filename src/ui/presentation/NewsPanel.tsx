import type { NewsVariant } from "./newsVariant";
import { StoryPlayer } from "./story/StoryPlayer";
import { useEffect, useRef, useState } from "react";
import type { GameSessionView, GameSessionViewSnapshot } from "../../application/gameSessionView";
import type { GameSessionErrorCode } from "../../application/gameSession";
import { translateSessionError, useI18n } from "../i18n";
import { StoryBlocks } from "./story/StoryBlocks";
import "./news.css";

/** Required interactions finish before the next bulletin can be acknowledged. */
export function getPresentedNewsId(snapshot: GameSessionViewSnapshot): string | null {
  const state = snapshot.state;
  if (
    !state?.mainFlow ||
    !snapshot.content?.mainFlow ||
    state.phase.type !== "playing" ||
    (snapshot.status !== "ready" && snapshot.status !== "saving")
  )
    return null;
  const pendingStoryId = state.pendingStoryIds[0];
  if (pendingStoryId)
    return (
      state.mainFlow.readNewsIds.find(
        (id) => snapshot.content!.mainFlow!.news[id].actionStoryId === pendingStoryId,
      ) ?? null
    );
  return (
    state.mainFlow.publishedNewsIds.find((id) => !state.mainFlow!.readNewsIds.includes(id)) ?? null
  );
}

function NewsArticle({
  session,
  snapshot,
  newsId,
  variant,
}: {
  session: GameSessionView;
  snapshot: GameSessionViewSnapshot;
  newsId: string;
  variant?: NewsVariant;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [error, setError] = useState<GameSessionErrorCode | "unexpected" | null>(null);
  const news = snapshot.content!.mainFlow!.news[newsId];
  const busy = snapshot.status !== "ready";
  const actionActive = Boolean(
    news.actionStoryId && snapshot.state!.pendingStoryIds[0] === news.actionStoryId,
  );
  const actionRegion = useRef<HTMLElement>(null);
  useEffect(() => {
    if (actionActive) {
      const region = actionRegion.current!;
      region.scrollIntoView?.({ block: "nearest" });
      (region.querySelector<HTMLElement>("input, button:not(:disabled)") ?? region).focus({
        preventScroll: true,
      });
    }
  }, [actionActive]);
  useEffect(() => {
    const element = dialog.current!;
    // Native top layer covers every app overlay, including diagnostics, and makes the background inert.
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = overflow;
    };
  }, []);
  const finishReading = async () => {
    if (busy || submitting.current || actionActive) return;
    submitting.current = true;
    setError(null);
    try {
      const result = await session.dispatch({ type: "readNews", newsId });
      if (!result.ok) setError(result.code);
    } catch {
      setError("unexpected");
    } finally {
      submitting.current = false;
    }
  };
  const finishAction = async () => {
    if (busy || submitting.current) return;
    submitting.current = true;
    setError(null);
    try {
      const result = await session.dispatch({
        type: "completeStory",
        storyId: news.actionStoryId!,
      });
      if (!result.ok) setError(result.code);
    } catch {
      setError("unexpected");
    } finally {
      submitting.current = false;
    }
  };
  const response = (
    <footer
      className={variant ? "news-sheet__response" : "news-sheet__footer"}
      ref={actionRegion}
      tabIndex={-1}
    >
      {variant && (
        <p className="news-sheet__response-label">
          {t(
            variant === "postscript"
              ? "news.postscriptLabel"
              : variant === "signature"
                ? "news.signatureLabel"
                : "news.receiptLabel",
          )}
        </p>
      )}
      {actionActive ? (
        <StoryPlayer
          key={news.actionStoryId}
          presentation="news"
          storyId={news.actionStoryId!}
          story={snapshot.content!.stories[news.actionStoryId!]}
          sessionView={session}
          attributes={snapshot.content!.attributes}
          busy={busy}
          narrationReady={
            snapshot.localizationStatus === "ready" || snapshot.localizationStatus === "fallback"
          }
          resumeStepId={
            snapshot.state!.storyCheckpoint?.storyId === news.actionStoryId
              ? snapshot.state!.storyCheckpoint!.resumeStepId
              : null
          }
          onComplete={finishAction}
        />
      ) : news.actionStoryId ? (
        <button
          className="story-button story-button--secondary news-sheet__confirm"
          type="button"
          disabled={busy}
          onClick={() => void finishReading()}
        >
          {t("news.confirmRead")}
        </button>
      ) : null}
      {!actionActive && (
        <p>{t(busy ? "news.saving" : news.actionStoryId ? "news.actionHint" : "news.closeHint")}</p>
      )}
      {error && (
        <p className="news-sheet__error" role="alert">
          {error === "unexpected"
            ? t("story.completeUnexpectedError")
            : translateSessionError(t, error)}
        </p>
      )}
    </footer>
  );
  return (
    <dialog
      ref={dialog}
      className="news-overlay"
      aria-modal="true"
      aria-labelledby="news-title"
      onCancel={(event) => {
        event.preventDefault();
        void finishReading();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) void finishReading();
      }}
    >
      <article className="news-sheet" data-news-variant={variant}>
        <header className="news-sheet__masthead">
          <div className="news-sheet__publication">
            <span className="news-sheet__seal" aria-hidden="true">
              {t("brand.seal")}
            </span>
            <span>{t("news.publication")}</span>
          </div>
          {!actionActive && (
            <button
              type="button"
              className="news-sheet__close"
              disabled={busy}
              onClick={() => void finishReading()}
              aria-label={t(news.actionStoryId ? "news.confirmRead" : "news.close")}
            >
              <span>{t(news.actionStoryId ? "news.confirmRead" : "news.close")}</span>
              <span aria-hidden="true">×</span>
            </button>
          )}
        </header>
        <div className="news-sheet__body" tabIndex={0}>
          <p className="news-sheet__section">{t("news.label")}</p>
          <h1 id="news-title">{news.title}</h1>
          <div className="news-sheet__rule" aria-hidden="true" />
          <StoryBlocks blocks={news.blocks} />
          {variant && response}
          <span className="news-sheet__end" aria-hidden="true">
            ■
          </span>
        </div>
        {!variant && response}
      </article>
    </dialog>
  );
}

/** Dismissing a bulletin commits reading; read bulletins have no lingering tab or list. */
export function NewsPanel({
  variant = "signature",
  session,
  snapshot,
}: {
  variant?: NewsVariant;
  session: GameSessionView;
  snapshot: GameSessionViewSnapshot;
}) {
  const newsId = getPresentedNewsId(snapshot);
  return newsId === null ? null : (
    <NewsArticle
      variant={variant}
      key={newsId}
      newsId={newsId}
      session={session}
      snapshot={snapshot}
    />
  );
}
