import { applyGameEffects } from "./effects";
import type { GameContentCatalog } from "../content/schema";
import type { TransitionContext } from "./commands";
import type { AttributeChangeSnapshot, GameState } from "./model";
import {
  countResolvedCases,
  findCaseIdsToUnlock,
  findStoryIdsToQueue,
  selectEnding,
  type ProgressionIssue,
  type ProgressionIssueCode,
} from "./progression";

export type ResolutionIssueCode =
  ProgressionIssueCode | "CASE_PROGRESS_INVALID" | "CHOICE_REFERENCE_INVALID";

export interface ResolutionIssue {
  readonly code: ResolutionIssueCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export type ResolutionResult =
  | {
      readonly ok: true;
      readonly nextState: GameState;
      readonly changes: readonly AttributeChangeSnapshot[];
    }
  | { readonly ok: false; readonly issues: readonly ResolutionIssue[] };

export interface ResolutionChoiceInput {
  readonly caseId: string;
  readonly nodeId: string;
  readonly choiceId: string;
}

const fail = (issues: readonly ResolutionIssue[]): ResolutionResult => ({ ok: false, issues });

const progressionFailure = (issues: readonly ProgressionIssue[]): ResolutionResult => fail(issues);

/**
 * Atomically derives every fact caused by a final choice. No partially computed state escapes:
 * callers receive either the complete settlement pipeline or diagnostic issues only.
 */
export const resolveFinalChoice = (
  state: Readonly<GameState>,
  input: ResolutionChoiceInput,
  content: Readonly<GameContentCatalog>,
  context: TransitionContext,
): ResolutionResult => {
  const definition = content.cases[input.caseId];
  const progress = state.cases[input.caseId];
  if (!definition || progress?.status !== "active") {
    return fail([
      {
        code: "CASE_PROGRESS_INVALID",
        path: ["cases", input.caseId],
        message: `Case "${input.caseId}" must be an active content case before settlement.`,
      },
    ]);
  }

  if (progress.currentNodeId !== input.nodeId) {
    return fail([
      {
        code: "CASE_PROGRESS_INVALID",
        path: ["cases", input.caseId, "currentNodeId"],
        message: `Case "${input.caseId}" is at node "${progress.currentNodeId}", not "${input.nodeId}".`,
      },
    ]);
  }

  const node = definition.nodes[input.nodeId];
  const choice = node?.choices.find((candidate) => candidate.id === input.choiceId);
  if (!node || !choice) {
    return fail([
      {
        code: "CHOICE_REFERENCE_INVALID",
        path: ["cases", input.caseId, "nodes", input.nodeId, "choices", input.choiceId],
        message: `Case "${input.caseId}" has no choice "${input.choiceId}" on node "${input.nodeId}".`,
      },
    ]);
  }
  if (choice.target.type !== "resolution") {
    return fail([
      {
        code: "CHOICE_REFERENCE_INVALID",
        path: ["cases", input.caseId, "nodes", input.nodeId, "choices", input.choiceId, "target"],
        message: `Choice "${input.choiceId}" does not target a resolution.`,
      },
    ]);
  }

  const resolutionId = choice.target.resolutionId;
  const resolution = definition.resolutions[resolutionId];
  if (!resolution) {
    return fail([
      {
        code: "RESOLUTION_REFERENCE_INVALID",
        path: ["cases", input.caseId, "resolutions", resolutionId],
        message: `Choice references unknown resolution "${resolutionId}" for case "${input.caseId}".`,
      },
    ]);
  }

  const applied = applyGameEffects(state, resolution.effects, content, [
    "cases",
    input.caseId,
    "resolutions",
    resolutionId,
    "effects",
  ]);
  if (!applied.ok) return fail(applied.issues);
  const { attributes, flags, changes } = applied;

  const postResolutionState: GameState = {
    ...state,
    attributes,
    flags,
    pendingStoryIds: [...state.pendingStoryIds],
    completedStoryIds: [...state.completedStoryIds],
    cases: {
      ...state.cases,
      [input.caseId]: {
        status: "resolved",
        history: [...progress.history, { nodeId: input.nodeId, choiceId: input.choiceId }],
        resolutionId,
        finalChoiceId: input.choiceId,
        snapshot: {
          attributeChanges: changes.map((change) => ({ ...change })),
          resolvedAt: context.nowIso,
          resolvedOrder: countResolvedCases(state) + 1,
        },
      },
    },
  };

  const unlockResult = findCaseIdsToUnlock(postResolutionState, content);
  if (!unlockResult.ok) {
    return progressionFailure(unlockResult.issues);
  }
  const cases = { ...postResolutionState.cases };
  for (const caseId of unlockResult.value) {
    cases[caseId] = { status: "pending" };
  }
  const postUnlockState: GameState = { ...postResolutionState, cases };

  const storyResult = findStoryIdsToQueue(postUnlockState, content);
  if (!storyResult.ok) {
    return progressionFailure(storyResult.issues);
  }
  const postStoryState: GameState = {
    ...postUnlockState,
    pendingStoryIds: [...postUnlockState.pendingStoryIds, ...storyResult.value],
  };

  const endingResult = selectEnding(postStoryState, content);
  if (!endingResult.ok) {
    return progressionFailure(endingResult.issues);
  }
  const ending = endingResult.value;

  return {
    ok: true,
    changes,
    nextState: ending
      ? {
          ...postStoryState,
          phase: { type: "ending", endingId: ending.endingId },
          pendingStoryIds: [...postStoryState.pendingStoryIds, ending.storyId],
        }
      : postStoryState,
  };
};
