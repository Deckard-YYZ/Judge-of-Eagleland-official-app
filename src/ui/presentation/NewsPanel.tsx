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
    state.pendingStoryIds.length ||
    (snapshot.status !== "ready" && snapshot.status !== "saving")
  )
    return null;
  return (
    state.mainFlow.publishedNewsIds.find((id) => !state.mainFlow!.readNewsIds.includes(id)) ?? null
  );
}

function NewsArticle({
  session,
  snapshot,
  newsId,
}: {
  session: GameSessionView;
  snapshot: GameSessionViewSnapshot;
  newsId: string;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [error, setError] = useState<GameSessionErrorCode | null>(null);
  const news = snapshot.content!.mainFlow!.news[newsId];
  const busy = snapshot.status !== "ready";
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
    if (busy || submitting.current) return;
    submitting.current = true;
    setError(null);
    try {
      const result = await session.dispatch({ type: "readNews", newsId });
      if (!result.ok) setError(result.code);
    } finally {
      submitting.current = false;
    }
  };
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
      <article className="news-sheet">
        <header className="news-sheet__masthead">
          <div className="news-sheet__publication">
            <span className="news-sheet__seal" aria-hidden="true">
              {t("brand.seal")}
            </span>
            <span>{t("news.publication")}</span>
          </div>
          <button
            type="button"
            className="news-sheet__close"
            disabled={busy}
            onClick={() => void finishReading()}
            aria-label={t("news.close")}
          >
            <span>{t("news.close")}</span>
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="news-sheet__body" tabIndex={0}>
          <p className="news-sheet__section">{t("news.label")}</p>
          <h1 id="news-title">{news.title}</h1>
          <div className="news-sheet__rule" aria-hidden="true" />
          <StoryBlocks blocks={news.blocks} />
          <span className="news-sheet__end" aria-hidden="true">
            ■
          </span>
        </div>
        <footer className="news-sheet__footer">
          <p>{t(busy ? "news.saving" : "news.closeHint")}</p>
          {error && (
            <p className="news-sheet__error" role="alert">
              {translateSessionError(t, error)}
            </p>
          )}
        </footer>
      </article>
    </dialog>
  );
}

/** Dismissing a bulletin commits reading; read bulletins have no lingering tab or list. */
export function NewsPanel({
  session,
  snapshot,
}: {
  session: GameSessionView;
  snapshot: GameSessionViewSnapshot;
}) {
  const newsId = getPresentedNewsId(snapshot);
  return newsId === null ? null : (
    <NewsArticle key={newsId} newsId={newsId} session={session} snapshot={snapshot} />
  );
}
