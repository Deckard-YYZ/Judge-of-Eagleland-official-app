import type { CaseDefinition, CaseId, ContentCatalog } from "../content/schema";
import type { CaseProgress, GameState } from "./model";

export type PendingOrActiveCaseProgress = Extract<
  CaseProgress,
  { status: "pending" } | { status: "active" }
>;
export type ResolvedCaseProgress = Extract<CaseProgress, { status: "resolved" }>;

export interface CaseListItem<TProgress extends CaseProgress> {
  readonly caseId: CaseId;
  readonly definition: Readonly<CaseDefinition>;
  readonly progress: Readonly<TProgress>;
}

const compareIds = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const caseItems = <TProgress extends CaseProgress>(
  state: Readonly<GameState>,
  content: Readonly<ContentCatalog>,
  accepts: (progress: CaseProgress) => progress is TProgress,
): CaseListItem<TProgress>[] => {
  const items: CaseListItem<TProgress>[] = [];

  for (const [caseId, progress] of Object.entries(state.cases)) {
    const definition = content.cases[caseId];
    // Normal callers validate state/content first; skipping keeps selectors total for diagnostics.
    if (definition && accepts(progress)) {
      items.push({ caseId, definition, progress });
    }
  }

  return items;
};

/** Pending and active cases share the same content-authored order in the sidebar. */
export const selectPendingAndActiveCases = (
  state: Readonly<GameState>,
  content: Readonly<ContentCatalog>,
): readonly CaseListItem<PendingOrActiveCaseProgress>[] =>
  caseItems(
    state,
    content,
    (progress): progress is PendingOrActiveCaseProgress => progress.status !== "resolved",
  ).sort(
    (left, right) =>
      left.definition.order - right.definition.order || compareIds(left.caseId, right.caseId),
  );

/** Most recently resolved cases appear first; case ID is only a deterministic tie-breaker. */
export const selectResolvedCases = (
  state: Readonly<GameState>,
  content: Readonly<ContentCatalog>,
): readonly CaseListItem<ResolvedCaseProgress>[] =>
  caseItems(
    state,
    content,
    (progress): progress is ResolvedCaseProgress => progress.status === "resolved",
  ).sort(
    (left, right) =>
      right.progress.snapshot.resolvedOrder - left.progress.snapshot.resolvedOrder ||
      compareIds(left.caseId, right.caseId),
  );
