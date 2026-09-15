import type { CaseProgress, GameState } from "../game/model";
import type { ContentCaseView, GameContentView } from "./gameContentView";

export type PendingOrActiveCaseProgress = Extract<
  CaseProgress,
  { status: "pending" } | { status: "active" }
>;
export type ResolvedCaseProgress = Extract<CaseProgress, { status: "resolved" }>;

export interface CaseListItem<TProgress extends CaseProgress> {
  readonly caseId: string;
  readonly definition: Readonly<ContentCaseView>;
  readonly progress: Readonly<TProgress>;
}

const items = <TProgress extends CaseProgress>(
  state: Readonly<GameState>,
  content: Readonly<GameContentView>,
  accepts: (progress: CaseProgress) => progress is TProgress,
): CaseListItem<TProgress>[] =>
  Object.entries(state.cases).flatMap(([caseId, progress]) => {
    const definition = content.cases[caseId];
    return definition && accepts(progress) ? [{ caseId, definition, progress }] : [];
  });

export const selectPendingAndActiveCases = (
  state: Readonly<GameState>,
  content: Readonly<GameContentView>,
): readonly CaseListItem<PendingOrActiveCaseProgress>[] =>
  items(
    state,
    content,
    (progress): progress is PendingOrActiveCaseProgress => progress.status !== "resolved",
  ).sort(
    (left, right) =>
      left.definition.order - right.definition.order || left.caseId.localeCompare(right.caseId),
  );

export const selectResolvedCases = (
  state: Readonly<GameState>,
  content: Readonly<GameContentView>,
): readonly CaseListItem<ResolvedCaseProgress>[] =>
  items(
    state,
    content,
    (progress): progress is ResolvedCaseProgress => progress.status === "resolved",
  ).sort(
    (left, right) =>
      right.progress.snapshot.resolvedOrder - left.progress.snapshot.resolvedOrder ||
      left.caseId.localeCompare(right.caseId),
  );
