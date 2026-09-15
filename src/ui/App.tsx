import type { GameSession, GameSessionLoadResult } from "../application/gameSession";
import { SessionProbe } from "./SessionProbe";

export interface AppProps {
  session: GameSession;
  reloadSession: () => Promise<GameSessionLoadResult>;
  runtimeStatus: {
    kind: "browser" | "tauri";
    supportsSqlite: boolean;
  };
  databaseProbe: {
    status: "checking" | "memory" | "connected" | "error";
    databaseUrl: string;
    message: string;
    sampleId?: string;
    error?: string;
  };
}

/** Minimal shell used while the session and game surfaces are assembled. */
export function App({ runtimeStatus, databaseProbe, session, reloadSession }: AppProps) {
  const isDesktop = runtimeStatus.kind === "tauri";
  const probeLabel = {
    checking: "检查中",
    memory: "浏览器内存模式",
    connected: "SQLite 已连接",
    error: "SQLite 不可用",
  }[databaseProbe.status];

  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="eyebrow">开发骨架</p>
        <h1>鹰国法官</h1>
        <p className="lede">稳定接口、开发替身与桌面运行环境。</p>
      </header>

      <section className="status-card" aria-labelledby="runtime-status-title">
        <div className="status-card__heading">
          <div>
            <p className="eyebrow">Runtime</p>
            <h2 id="runtime-status-title">运行环境状态</h2>
          </div>
          <span className={`status-pill status-pill--${databaseProbe.status}`}>{probeLabel}</span>
        </div>

        <dl className="status-list">
          <div>
            <dt>宿主</dt>
            <dd>{isDesktop ? "Tauri 2 桌面窗口" : "浏览器预览"}</dd>
          </div>
          <div>
            <dt>数据库</dt>
            <dd>{databaseProbe.databaseUrl}</dd>
          </div>
          <div>
            <dt>写入能力</dt>
            <dd>{runtimeStatus.supportsSqlite ? "桌面插件探针" : "内存模式"}</dd>
          </div>
        </dl>

        <p className="status-message">{databaseProbe.message}</p>
        {databaseProbe.sampleId ? (
          <p className="status-detail">探针标记：{databaseProbe.sampleId}</p>
        ) : null}
        {databaseProbe.error ? <p className="status-error">{databaseProbe.error}</p> : null}
      </section>
      <SessionProbe session={session} reload={reloadSession} />
    </main>
  );
}
