import { useEffect, useId, useRef, useState } from "react";
import type { GameSessionView, GameSessionViewSnapshot } from "../../application/gameSessionView";
import { DecisionPanel } from "./DecisionPanel";
import { ResolutionPanel } from "./ResolutionPanel";
import { CaseBody, CaseSummary, CharacterSection } from "./TextBlocks";
import "./case.css";

export interface CaseReaderProps {
  snapshot: GameSessionViewSnapshot;
  dispatch: GameSessionView["dispatch"];
}

export function CaseReader({ snapshot, dispatch }: CaseReaderProps) {
  const titleId = useId();
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  const selectedCaseId = snapshot.selectedCaseId;

  // Snapshot boundary: definition and progress must be resolved from this exact
  // snapshot together. Caching either one would risk mixing content/state versions.
  const caseDefinition =
    selectedCaseId && snapshot.content ? snapshot.content.cases[selectedCaseId] : undefined;
  const progress =
    selectedCaseId && snapshot.state ? snapshot.state.cases[selectedCaseId] : undefined;
  const panelKey =
    selectedCaseId && progress
      ? progress.status === "active"
        ? `${selectedCaseId}:node:${progress.currentNodeId}`
        : `${selectedCaseId}:${progress.status}`
      : null;
  const previousPanelKey = useRef(panelKey);
  const caseCommandsAllowed =
    snapshot.status === "ready" &&
    snapshot.state?.phase.type === "playing" &&
    snapshot.state.pendingStoryIds.length === 0;

  useEffect(() => {
    setCommandError(null);
    startingRef.current = false;
    setStarting(false);
  }, [selectedCaseId]);

  useEffect(() => {
    const panelChanged = previousPanelKey.current !== panelKey;
    previousPanelKey.current = panelKey;

    // saving exposes the previous committed node; wait for the next ready snapshot
    // before moving focus to the replacement node or the persisted resolution.
    if (panelChanged && snapshot.status === "ready") {
      panelHeadingRef.current?.focus();
    }
  }, [panelKey, snapshot.status]);

  const startCase = async (): Promise<void> => {
    if (!selectedCaseId || !caseCommandsAllowed || startingRef.current) {
      return;
    }

    // Capture the selected ID before dispatch. Selection is UI state and must not
    // be re-read after an async boundary to construct a different command.
    const caseId = selectedCaseId;
    startingRef.current = true;
    setStarting(true);
    setCommandError(null);

    try {
      const result = await dispatch({ type: "startCase", caseId });
      if (!result.ok) {
        setCommandError(result.message);
      }
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  if (snapshot.status === "idle") {
    return <CaseReaderState title="尚未载入档案" detail="进入本地档案后即可查阅案件。" />;
  }

  if (snapshot.status === "loading") {
    return <CaseReaderState title="正在调取案卷" detail="请稍候，档案内容正在载入。" busy />;
  }

  if (snapshot.status === "error") {
    return <CaseReaderState title="无法载入案卷" detail={snapshot.error.message} tone="error" />;
  }

  if (!selectedCaseId) {
    return <CaseReaderState title="尚未选择案件" detail="请从案卷列表中选择一项记录。" />;
  }

  if (!caseDefinition || !progress) {
    return (
      <CaseReaderState
        title="案卷引用无效"
        detail="当前状态与内容包无法匹配此案件，请重新载入档案。"
        tone="error"
      />
    );
  }

  // A ready snapshot is not sufficient authority to mutate a case: queued
  // stories and ending/ended phases are explicit read-only boundaries.
  const interactionLocked = !caseCommandsAllowed;
  const currentNode =
    progress.status === "active" ? caseDefinition.nodes[progress.currentNodeId] : undefined;

  return (
    <article
      className="case-reader"
      aria-labelledby={titleId}
      data-case-id={selectedCaseId}
      data-case-status={progress.status}
      data-session-status={snapshot.status}
    >
      <header className="case-reader__header">
        <div>
          <p className="kicker">Judicial record</p>
          <h1 id={titleId}>{caseDefinition.title}</h1>
        </div>
        <span className={`case-reader__status case-reader__status--${progress.status}`}>
          {progress.status === "pending"
            ? "待审理"
            : progress.status === "active"
              ? "审理中"
              : "已归档"}
        </span>
      </header>

      {snapshot.status === "saving" ? (
        <div className="case-reader__notice" role="status" aria-live="polite">
          正在归档当前操作，本案暂时只读。
        </div>
      ) : snapshot.status === "needsReload" ? (
        <div className="case-reader__notice case-reader__notice--error" role="alert">
          <strong>需要重新载入档案。</strong> {snapshot.error.message}
        </div>
      ) : commandError ? (
        <div className="case-reader__notice case-reader__notice--error" role="alert">
          {commandError}
        </div>
      ) : null}

      <div
        className="case-reader__scroll-region"
        role="region"
        aria-label={`${caseDefinition.title}正文与裁定`}
        tabIndex={0}
      >
        <CharacterSection characters={caseDefinition.characters} />
        <CaseSummary blocks={caseDefinition.summary} />
        <CaseBody blocks={caseDefinition.body} />

        <div className="case-reader__workflow">
          {progress.status === "pending" ? (
            <section className="case-start" aria-labelledby={`${titleId}-start`}>
              <p className="kicker">Review docket</p>
              <h2 id={`${titleId}-start`} ref={panelHeadingRef} tabIndex={-1}>
                准备开始审理
              </h2>
              <p>开始后将进入首个裁定节点。案卷正文会保留在当前页面。</p>
              <button
                className="button button--primary case-start__button"
                type="button"
                disabled={interactionLocked || starting}
                onClick={() => void startCase()}
              >
                {starting || snapshot.status === "saving" ? "正在归档…" : "开始案件"}
              </button>
            </section>
          ) : progress.status === "active" ? (
            currentNode ? (
              <DecisionPanel
                caseId={selectedCaseId}
                nodeId={progress.currentNodeId}
                node={currentNode}
                dispatch={dispatch}
                disabled={interactionLocked}
                headingRef={panelHeadingRef}
                onCommandError={setCommandError}
              />
            ) : (
              <section className="case-reader__integrity-error" role="alert">
                <h2>裁定节点不可用</h2>
                <p>存档引用的当前节点不在内容包中。请重新载入或检查内容版本。</p>
              </section>
            )
          ) : (
            <ResolutionPanel resolution={progress.snapshot} headingRef={panelHeadingRef} />
          )}
        </div>
      </div>
    </article>
  );
}

interface CaseReaderStateProps {
  title: string;
  detail: string;
  busy?: boolean;
  tone?: "neutral" | "error";
}

function CaseReaderState({ title, detail, busy = false, tone = "neutral" }: CaseReaderStateProps) {
  return (
    <section
      className={`case-reader-state case-reader-state--${tone}`}
      aria-busy={busy}
      role={tone === "error" ? "alert" : "status"}
    >
      <p className="kicker">Judicial archive</p>
      <h1>{title}</h1>
      <p>{detail}</p>
    </section>
  );
}
