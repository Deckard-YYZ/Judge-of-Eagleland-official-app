import type { GameSessionView, GameSessionViewSnapshot } from "../../application/gameSessionView";
import { useI18n } from "../i18n";
import { StoryBlocks } from "./story/StoryBlocks";

/** Opening a bulletin is presentation only; its explicit completion commits the action hook. */
export function NewsPanel({
  session,
  snapshot,
}: {
  session: GameSessionView;
  snapshot: GameSessionViewSnapshot;
}) {
  const { t } = useI18n();
  const flow = snapshot.state?.mainFlow;
  const content = snapshot.content?.mainFlow;
  if (!flow || !content || flow.publishedNewsIds.length === 0) return null;
  return (
    <section className="news-panel" aria-label={t("news.label")}>
      {flow.publishedNewsIds.map((newsId) => {
        const news = content.news[newsId];
        const read = flow.readNewsIds.includes(newsId);
        return (
          <details key={newsId} className="news-panel__item">
            <summary>
              {news.title}
              {read ? ` · ${t("news.read")}` : ""}
            </summary>
            <StoryBlocks blocks={news.blocks} />
            {!read && (
              <button
                type="button"
                className="button button--primary"
                disabled={snapshot.status !== "ready"}
                onClick={() => void session.dispatch({ type: "readNews", newsId })}
              >
                {t("news.complete")}
              </button>
            )}
          </details>
        );
      })}
    </section>
  );
}
