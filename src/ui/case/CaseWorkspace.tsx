import type { InstructionVariant } from "./instructionVariant";
import type { DecisionPresentationHistory, PresentationMode } from "./presentationPolicy";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GameSessionView, GameSessionViewSnapshot } from "../../application/gameSessionView";
import type { CaseId } from "../../content/schema";
import { useI18n } from "../i18n";
import { CaseReader } from "./CaseReader";

export const CASE_OPEN_DELAY_MS = 0;

export interface CaseWorkspaceProps {
  snapshot: GameSessionViewSnapshot;
  obscured?: boolean;
  dispatch: GameSessionView["dispatch"];
  reload: GameSessionView["reload"];
  caseOpenDelayMs?: number;
  decisionRevealDelayMs?: number;
  instructionVariant?: InstructionVariant;
  presentationMode?: PresentationMode;
  presentationHistory?: DecisionPresentationHistory;
}

/** UI-only document handoff. Selection remains immediate; document presentation is deferred. */
export function CaseWorkspace({
  snapshot,
  obscured = false,
  dispatch,
  reload,
  caseOpenDelayMs = CASE_OPEN_DELAY_MS,
  decisionRevealDelayMs,
  instructionVariant,
  presentationMode,
  presentationHistory,
}: CaseWorkspaceProps) {
  const { t } = useI18n();
  const requestedCaseId = snapshot.selectedCaseId;
  const contentIdentity = JSON.stringify([
    snapshot.envelope?.contentRef.packageId,
    snapshot.envelope?.contentRef.version,
  ]);
  const [presentedContentIdentity, setPresentedContentIdentity] = useState(contentIdentity);
  const [presentedCaseId, setPresentedCaseId] = useState<CaseId | null>(null);
  const requestVersion = useRef(0);

  useEffect(() => {
    const version = ++requestVersion.current;
    if (!requestedCaseId) {
      setPresentedCaseId(null);
      return;
    }

    setPresentedCaseId(null);
    const timerId = window.setTimeout(
      () => {
        // A later sidebar choice owns a newer version. The old timer must never
        // restore a document that is no longer the selected destination.
        if (requestVersion.current === version) {
          setPresentedContentIdentity(contentIdentity);
          setPresentedCaseId(requestedCaseId);
        }
      },
      Math.max(0, caseOpenDelayMs),
    );

    return () => {
      window.clearTimeout(timerId);
    };
  }, [caseOpenDelayMs, requestedCaseId, contentIdentity]);

  // Effects run after paint, so derive visibility synchronously from both IDs.
  // This prevents the previously presented document from flashing for one frame.
  const visibleCaseId =
    requestedCaseId === presentedCaseId && contentIdentity === presentedContentIdentity
      ? presentedCaseId
      : null;
  const loadingCaseId = requestedCaseId && visibleCaseId === null ? requestedCaseId : null;

  const presentedSnapshot = useMemo(
    () => Object.freeze({ ...snapshot, selectedCaseId: visibleCaseId }),
    [snapshot, visibleCaseId],
  );

  if (loadingCaseId && snapshot.status !== "needsReload" && snapshot.status !== "error") {
    const title = snapshot.content?.cases[loadingCaseId]?.title;
    return (
      <section className="case-loading-state" role="status" aria-live="polite" aria-busy="true">
        <span className="case-loading-state__spinner" aria-hidden="true" />
        <p className="kicker">{t("case.retrievingKicker")}</p>
        <h1>{t("case.loadingTitle")}</h1>
        <p>{title ? t("case.retrievingWithTitle", { title }) : t("case.retrievingWithoutTitle")}</p>
      </section>
    );
  }

  return (
    <CaseReader
      key={JSON.stringify([contentIdentity, visibleCaseId])}
      snapshot={presentedSnapshot}
      obscured={obscured}
      dispatch={dispatch}
      reload={reload}
      decisionRevealDelayMs={decisionRevealDelayMs}
      instructionVariant={instructionVariant}
      presentationMode={presentationMode}
      presentationHistory={presentationHistory}
    />
  );
}
