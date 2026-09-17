import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { GameSessionView, GameSessionViewSnapshot } from "../../application/gameSessionView";
import { translateSessionError, useI18n } from "../i18n";
import { PendingCaseReview } from "./PendingCaseReview";
import { DecisionPanel } from "./DecisionPanel";
import { ResolutionPanel } from "./ResolutionPanel";
import { CaseBody, CaseSummary, CharacterSection } from "./TextBlocks";
import "./case.css";

export interface CaseReaderProps {
  snapshot: GameSessionViewSnapshot;
  dispatch: GameSessionView["dispatch"];
  reload: GameSessionView["reload"];
  decisionRevealDelayMs?: number;
}

export function CaseReader({ snapshot, dispatch, reload, decisionRevealDelayMs }: CaseReaderProps) {
  const { t } = useI18n();
  const titleId = useId();
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const [autoStart, setAutoStart] = useState<{
    caseId: string;
    startedAt: number;
    nodeId: string | null;
  } | null>(null);
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

  const onThinkingStarted = useCallback(
    (startedAt: number) => {
      if (selectedCaseId) setAutoStart({ caseId: selectedCaseId, startedAt, nodeId: null });
    },
    [selectedCaseId],
  );

  useEffect(() => {
    if (progress?.status !== "active" || !selectedCaseId) return;
    setAutoStart((current) =>
      current?.caseId === selectedCaseId && current.nodeId === null
        ? { ...current, nodeId: progress.currentNodeId }
        : current,
    );
  }, [selectedCaseId, progress]);

  if (snapshot.status === "idle") {
    return <CaseReaderState title={t("case.idleTitle")} detail={t("case.idleDetail")} />;
  }

  if (snapshot.status === "loading") {
    return <CaseReaderState title={t("case.loadingTitle")} detail={t("case.loadingDetail")} busy />;
  }

  if (snapshot.status === "error" || snapshot.status === "needsReload") {
    return (
      <CaseReaderState
        title={t(snapshot.status === "needsReload" ? "case.reloadNotice" : "case.errorTitle")}
        detail={
          snapshot.error ? translateSessionError(t, snapshot.error.code) : t("case.invalidDetail")
        }
        tone="error"
      >
        <button className="button button--primary" type="button" onClick={() => void reload()}>
          {t("case.reload")}
        </button>
      </CaseReaderState>
    );
  }

  if (!selectedCaseId) {
    return <CaseReaderGuide />;
  }

  if (!caseDefinition || !progress) {
    return (
      <CaseReaderState
        title={t("case.invalidTitle")}
        detail={t("case.invalidDetail")}
        tone="error"
      />
    );
  }

  // A ready snapshot is not sufficient authority to mutate a case: queued
  // stories and ending/ended phases are explicit read-only boundaries.
  const interactionLocked = !caseCommandsAllowed;
  const currentNode =
    progress.status === "active" ? caseDefinition.nodes[progress.currentNodeId] : undefined;
  const resolvedPresentation =
    progress.status === "resolved" ? caseDefinition.resolutions[progress.resolutionId] : undefined;
  const finalChoice =
    progress.status === "resolved"
      ? Object.values(caseDefinition.nodes)
          .flatMap((node) => node.choices)
          .find((choice) => choice.id === progress.finalChoiceId)
      : undefined;

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
          <p className="kicker">{t("case.recordKicker")}</p>
          <h1 id={titleId}>{caseDefinition.title}</h1>
        </div>
        <span className={`case-reader__status case-reader__status--${progress.status}`}>
          {t(`case.status.${progress.status}`)}
        </span>
      </header>

      {snapshot.status === "saving" ? (
        <div className="case-reader__notice" role="status" aria-live="polite">
          {t("case.savingNotice")}
        </div>
      ) : commandError ? (
        <div className="case-reader__notice case-reader__notice--error" role="alert">
          {commandError}
        </div>
      ) : null}

      <div
        className="case-reader__scroll-region"
        role="region"
        aria-label={t("case.regionAria", { title: caseDefinition.title })}
        tabIndex={0}
      >
        <CharacterSection characters={caseDefinition.characters} />
        <CaseSummary blocks={caseDefinition.summary} />
        <CaseBody blocks={caseDefinition.body} />

        <div className="case-reader__workflow">
          {progress.status === "pending" ? (
            <PendingCaseReview
              key={selectedCaseId}
              caseId={selectedCaseId}
              dispatch={dispatch}
              disabled={interactionLocked}
              onThinkingStarted={onThinkingStarted}
            />
          ) : progress.status === "active" ? (
            currentNode ? (
              <DecisionPanel
                key={progress.currentNodeId}
                caseId={selectedCaseId}
                nodeId={progress.currentNodeId}
                node={currentNode}
                dispatch={dispatch}
                disabled={interactionLocked}
                revealDelayMs={decisionRevealDelayMs}
                thinkingStartedAt={
                  autoStart?.caseId === selectedCaseId &&
                  (autoStart.nodeId === null || autoStart.nodeId === progress.currentNodeId)
                    ? autoStart.startedAt
                    : undefined
                }
                headingRef={panelHeadingRef}
                onCommandError={setCommandError}
              />
            ) : (
              <section className="case-reader__integrity-error" role="alert">
                <h2>{t("case.nodeUnavailableTitle")}</h2>
                <p>{t("case.nodeUnavailableDetail")}</p>
              </section>
            )
          ) : resolvedPresentation ? (
            <ResolutionPanel
              resolution={progress.snapshot}
              finalChoiceText={finalChoice?.text ?? progress.finalChoiceId}
              verdict={resolvedPresentation.verdict}
              result={resolvedPresentation.result}
              attributes={snapshot.content!.attributes}
              headingRef={panelHeadingRef}
            />
          ) : (
            <section className="case-reader__integrity-error" role="alert">
              <h2>{t("case.nodeUnavailableTitle")}</h2>
              <p>{t("case.nodeUnavailableDetail")}</p>
            </section>
          )}
        </div>
      </div>
    </article>
  );
}

function CaseReaderGuide() {
  const { t } = useI18n();

  return (
    <section className="case-reader-guide" role="status" aria-labelledby="archive-guide-title">
      <div className="archive-emblem" aria-hidden="true">
        <span>{t("brand.seal")}</span>
        <small>{t("brand.office")}</small>
      </div>
      <p className="kicker">{t("case.guideKicker")}</p>
      <h1 id="archive-guide-title">{t("case.guideTitle")}</h1>
      <p>{t("case.guideDetail")}</p>
    </section>
  );
}

interface CaseReaderStateProps {
  title: string;
  detail: string;
  busy?: boolean;
  tone?: "neutral" | "error";
  children?: ReactNode;
}

function CaseReaderState({
  title,
  detail,
  busy = false,
  tone = "neutral",
  children,
}: CaseReaderStateProps) {
  const { t } = useI18n();

  return (
    <section
      className={`case-reader-state case-reader-state--${tone}`}
      aria-busy={busy}
      role={tone === "error" ? "alert" : "status"}
    >
      <p className="kicker">{t("case.stateKicker")}</p>
      <h1>{title}</h1>
      <p>{detail}</p>
      {children}
    </section>
  );
}
