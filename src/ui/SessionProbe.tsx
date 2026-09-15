import { useState, useSyncExternalStore } from "react";
import type { GameSession, GameSessionLoadResult } from "../application/gameSession";

interface SessionProbeProps {
  session: GameSession;
  reload: () => Promise<GameSessionLoadResult>;
}

/** 仅消费会话接口，供各开发线确认替身可独立接入。 */
export function SessionProbe({ session, reload }: SessionProbeProps) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [message, setMessage] = useState("");
  const locked = snapshot.status === "loading" || snapshot.status === "saving";
  const firstCaseId = snapshot.content?.initial.caseIds[0];
  const progress = firstCaseId ? snapshot.state?.cases[firstCaseId] : undefined;

  async function startCase() {
    if (!firstCaseId) {
      return;
    }

    const result = await session.dispatch({ type: "startCase", caseId: firstCaseId });
    setMessage(result.ok ? "开始命令已保存，已发布新状态。" : result.message);
  }

  async function reloadSave() {
    const result = await reload();
    setMessage(result.ok ? "已从同一内存仓储重新读取。" : result.message);
  }

  return (
    <section className="status-card session-card" aria-labelledby="session-title">
      <div className="status-card__heading">
        <div>
          <p className="eyebrow">接口联调</p>
          <h2 id="session-title">两案件样本 · 内存会话</h2>
        </div>
        <span className="status-pill status-pill--memory">{snapshot.status}</span>
      </div>

      <p className="status-message">
        此页验证加载、开始与重新读取接口。样本存档只保留在本次页面内，刷新后重置。
      </p>

      {snapshot.envelope && snapshot.content ? (
        <dl className="status-list">
          <div>
            <dt>内容版本 / 案件数</dt>
            <dd>
              {snapshot.content.manifest.version} / {Object.keys(snapshot.content.cases).length}
            </dd>
          </div>
          <div>
            <dt>已提交 revision</dt>
            <dd>{snapshot.envelope.revision}</dd>
          </div>
          <div>
            <dt>首案状态</dt>
            <dd>{progress?.status ?? "未解锁"}</dd>
          </div>
        </dl>
      ) : null}

      <div className="probe-actions">
        <button
          disabled={snapshot.status !== "ready" || progress?.status !== "pending"}
          onClick={() => void startCase()}
        >
          验证开始案件
        </button>
        <button disabled={locked} onClick={() => void reloadSave()}>
          重新读取样本
        </button>
      </div>
      <p className="status-message" role="status">
        {snapshot.error?.message ?? message}
      </p>
    </section>
  );
}
