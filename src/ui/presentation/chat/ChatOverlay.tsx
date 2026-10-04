import type {
  GameSessionView,
  GameSessionViewSnapshot,
} from "../../../application/gameSessionView";
import { StoryBlocks } from "../story/StoryBlocks";
import { useI18n } from "../../i18n";
import "./chat.css";

/** Passive, non-modal conversations. Only committed session facts form the transcript. */
export function ChatOverlay({
  session,
  snapshot,
}: {
  session: GameSessionView;
  snapshot: GameSessionViewSnapshot;
}) {
  const { t } = useI18n();
  const flow = snapshot.state?.mainFlow;
  const content = snapshot.content?.mainFlow;
  if (!flow || !content || Object.keys(flow.chats).length === 0) return null;
  return (
    <aside className="chat-overlay" aria-label={t("chat.label")}>
      {Object.entries(flow.chats).map(([instanceId, progress]) => {
        const chat = content.chats[progress.chatId];
        const current = chat.nodes[progress.currentNodeId];
        return (
          <section className="chat-event" key={instanceId} aria-labelledby={`chat-${instanceId}`}>
            <header className="chat-event__header">
              <p>{chat.characterName}</p>
              <h2 id={`chat-${instanceId}`}>{chat.title}</h2>
            </header>
            <div
              className="chat-event__messages"
              role="log"
              aria-live="polite"
              aria-label={chat.title}
            >
              {progress.history.map((entry, index) => (
                <div key={`${index}:${entry.nodeId}`}>
                  <div className="chat-event__received">
                    <StoryBlocks blocks={chat.nodes[entry.nodeId].blocks} />
                  </div>
                  <p className="chat-event__sent">
                    <span className="sr-only">{t("chat.you")}</span>
                    {chat.nodes[entry.nodeId].replies[entry.replyId]}
                  </p>
                </div>
              ))}
              <div className="chat-event__received">
                <StoryBlocks blocks={current.blocks} />
              </div>
            </div>
            <div className="chat-event__replies" aria-label={t("chat.replies")}>
              {Object.entries(current.replies).map(([replyId, text]) => (
                <button
                  className="button button--secondary"
                  type="button"
                  key={replyId}
                  disabled={snapshot.status !== "ready"}
                  onClick={() =>
                    void session.dispatch({
                      type: "replyChat",
                      instanceId,
                      nodeId: progress.currentNodeId,
                      replyId,
                    })
                  }
                >
                  {text}
                </button>
              ))}
            </div>
            <p className="chat-event__hint">{t("chat.canWait")}</p>
          </section>
        );
      })}
    </aside>
  );
}
