import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { GameContentView } from "../../../application/gameContentView";
import type { GameSessionErrorCode } from "../../../application/gameSession";
import type {
  GameSessionView,
  GameSessionViewSnapshot,
} from "../../../application/gameSessionView";
import { translateSessionError, useI18n } from "../../i18n";
import "./chat.css";

type MainFlow = NonNullable<NonNullable<GameSessionViewSnapshot["state"]>["mainFlow"]>;
type Progress = MainFlow["chats"][string];
type Result = MainFlow["chatResults"][string];
type ChatContent = NonNullable<GameContentView["mainFlow"]>["chats"][string];
type Reply = Progress["history"][number];
interface VisibleChat {
  progress: Progress;
  ending: Result | null;
  slot: number;
}
interface Position {
  x: number;
  y: number;
}
const EXIT_DELAY_MS = 4000;

function ChatWindow({
  instanceId,
  item,
  chat,
  busy,
  obscured,
  onReply,
  onExpire,
  onRaise,
  front,
}: {
  instanceId: string;
  item: VisibleChat;
  chat: ChatContent;
  busy: boolean;
  obscured: boolean;
  onReply(
    instanceId: string,
    nodeId: string,
    replyId: string,
  ): ReturnType<GameSessionView["dispatch"]>;
  onExpire(instanceId: string): void;
  onRaise(instanceId: string): void;
  front: boolean;
}) {
  const { t } = useI18n();
  const { progress, ending, slot } = item;
  const frame = useRef<HTMLElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; dx: number; dy: number } | null>(null);
  const remaining = useRef(EXIT_DELAY_MS);
  const submitting = useRef(false);
  const [error, setError] = useState<GameSessionErrorCode | null>(null);

  const constrain = useCallback((point: Position): Position => {
    const rect = frame.current!.getBoundingClientRect();
    return {
      x: Math.max(8, Math.min(point.x, document.documentElement.clientWidth - rect.width - 8)),
      y: Math.max(8, Math.min(point.y, window.innerHeight - rect.height - 8)),
    };
  }, []);
  useLayoutEffect(() => {
    const place = () =>
      setPosition((previous) => {
        const rect = frame.current!.getBoundingClientRect();
        // Independent windows start offset; moving one never reflows the case workspace.
        return constrain(
          previous ?? {
            x: document.documentElement.clientWidth - rect.width - 24 - slot * 32,
            y: Math.max(64, window.innerHeight - rect.height - 160) + slot * 32,
          },
        );
      });
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [constrain, slot]);
  useLayoutEffect(() => {
    const log = messages.current!;
    log.scrollTop = log.scrollHeight;
  }, [progress.currentNodeId, progress.history.length, ending, chat]);
  useEffect(() => {
    if (!ending || obscured) return;
    const started = performance.now();
    const timeout = window.setTimeout(() => onExpire(instanceId), remaining.current);
    return () => {
      window.clearTimeout(timeout);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [ending, obscured, instanceId, onExpire]);

  const beginDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const rect = frame.current!.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    setPosition(
      constrain({ x: event.clientX - drag.current.dx, y: event.clientY - drag.current.dy }),
    );
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };
  const moveWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = {
      ArrowLeft: [-20, 0],
      ArrowRight: [20, 0],
      ArrowUp: [0, -20],
      ArrowDown: [0, 20],
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    const rect = frame.current!.getBoundingClientRect();
    setPosition(constrain({ x: rect.left + delta[0], y: rect.top + delta[1] }));
  };
  const reply = async (replyId: string) => {
    if (submitting.current || busy || ending) return;
    submitting.current = true;
    setError(null);
    try {
      const result = await onReply(instanceId, progress.currentNodeId, replyId);
      if (!result.ok) setError(result.code);
    } finally {
      submitting.current = false;
    }
  };
  const current = chat.nodes[progress.currentNodeId];
  return (
    <section
      ref={frame}
      className={`chat-event${ending ? " chat-event--ended" : ""}${dragging ? " chat-event--dragging" : ""}`}
      aria-labelledby={`chat-${instanceId}`}
      data-instance={instanceId}
      style={{
        left: position?.x,
        top: position?.y,
        visibility: position ? "visible" : "hidden",
        zIndex: front ? 2 : 1,
      }}
      onPointerDownCapture={() => onRaise(instanceId)}
      onFocusCapture={() => onRaise(instanceId)}
    >
      <button
        className="chat-event__handle"
        type="button"
        aria-label={t("chat.move", { name: chat.characterName })}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onKeyDown={moveWithKeyboard}
      >
        <span id={`chat-${instanceId}`}>{chat.title}</span>
      </button>
      <div
        ref={messages}
        className="chat-event__messages"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={chat.title}
        tabIndex={0}
      >
        {progress.history.map((entry, index) => (
          <div key={`${index}:${entry.nodeId}`}>
            <p className="chat-event__line">
              <span>{t("chat.other")} </span>
              {chat.nodes[entry.nodeId].blocks.map((block) => block.text).join("\n")}
            </p>
            <p className="chat-event__line">
              <span>{t("chat.you")} </span>
              {chat.nodes[entry.nodeId].replies[entry.replyId]}
            </p>
          </div>
        ))}
        {ending?.terminalNodeId ? (
          <p className="chat-event__line">
            <span>{t("chat.other")} </span>
            {chat.nodes[ending.terminalNodeId].blocks.map((block) => block.text).join("\n")}
          </p>
        ) : (
          <p className="chat-event__line">
            <span>{t("chat.other")} </span>
            {current.blocks.map((block) => block.text).join("\n")}
          </p>
        )}
        {ending && <p className="chat-event__line">{t("chat.ended")}</p>}
        {!ending && (
          <div className="chat-event__replies" aria-label={t("chat.replies")}>
            {Object.entries(current.replies).map(([replyId, text], index) => (
              <button
                className="chat-event__reply"
                type="button"
                key={replyId}
                disabled={busy || obscured}
                onClick={() => void reply(replyId)}
              >
                <span aria-hidden="true">[{index + 1}] </span>
                {text}
              </button>
            ))}
          </div>
        )}
        {error && (
          <p className="chat-event__line" role="alert">
            {translateSessionError(t, error)}
          </p>
        )}
      </div>
    </section>
  );
}

function Conversations({
  session,
  snapshot,
  flow,
  content,
  obscured,
}: {
  session: GameSessionView;
  snapshot: GameSessionViewSnapshot;
  flow: MainFlow;
  content: NonNullable<GameContentView["mainFlow"]>;
  obscured: boolean;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState<Record<string, VisibleChat>>(() =>
    Object.fromEntries(
      Object.entries(flow.chats).map(([id, progress], slot) => [
        id,
        { progress, ending: null, slot },
      ]),
    ),
  );
  const [front, setFront] = useState<string | null>(null);
  const pendingReplies = useRef<Record<string, Reply>>({});
  useLayoutEffect(() => {
    // Only instances seen active in this UI can retire. Loading old results never replays them.
    setVisible((previous) => {
      const next = { ...previous };
      const occupied = new Set(Object.values(previous).map((item) => item.slot));
      for (const [id, progress] of Object.entries(flow.chats)) {
        let slot = previous[id]?.slot ?? 0;
        if (!previous[id]) {
          while (occupied.has(slot)) slot++;
          occupied.add(slot);
        }
        next[id] = { progress, ending: null, slot };
      }
      for (const [id, item] of Object.entries(previous)) {
        if (flow.chats[id] || item.ending) continue;
        const ending = flow.chatResults[id];
        const reply = pendingReplies.current[id];
        next[id] = {
          ...item,
          ending,
          progress:
            ending.reason === "normal" && reply?.nodeId === item.progress.currentNodeId
              ? { ...item.progress, history: [...item.progress.history, reply] }
              : item.progress,
        };
      }
      return next;
    });
  }, [flow.chats, flow.chatResults]);
  const expire = useCallback((instanceId: string) => {
    setVisible((previous) => {
      const next = { ...previous };
      delete next[instanceId];
      return next;
    });
    delete pendingReplies.current[instanceId];
  }, []);
  const reply = async (instanceId: string, nodeId: string, replyId: string) => {
    pendingReplies.current[instanceId] = { nodeId, replyId };
    const result = await session.dispatch({ type: "replyChat", instanceId, nodeId, replyId });
    if (!result.ok) delete pendingReplies.current[instanceId];
    return result;
  };
  return (
    <aside
      className="chat-overlay"
      aria-label={t("chat.label")}
      inert={obscured ? true : undefined}
      aria-hidden={obscured ? true : undefined}
    >
      {Object.entries(visible).map(([instanceId, item]) => (
        <ChatWindow
          key={instanceId}
          instanceId={instanceId}
          item={item}
          chat={content.chats[item.progress.chatId]}
          busy={snapshot.status !== "ready"}
          obscured={obscured}
          onReply={reply}
          onExpire={expire}
          onRaise={setFront}
          front={front === instanceId}
        />
      ))}
    </aside>
  );
}

/** Floating presentation of committed conversations; position and exit delays never enter saves. */
export function ChatOverlay({
  session,
  snapshot,
  obscured = false,
}: {
  session: GameSessionView;
  snapshot: GameSessionViewSnapshot;
  obscured?: boolean;
}) {
  const flow = snapshot.state?.mainFlow;
  const content = snapshot.content?.mainFlow;
  if (!flow || !content) return null;
  return (
    <Conversations
      key={`${snapshot.envelope!.saveId}:${snapshot.envelope!.contentRef.packageId}:${snapshot.envelope!.contentRef.version}`}
      session={session}
      snapshot={snapshot}
      flow={flow}
      content={content}
      obscured={obscured}
    />
  );
}
