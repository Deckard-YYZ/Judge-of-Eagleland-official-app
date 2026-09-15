import type { ContentCatalog } from "../content/schema";
import type { GameState } from "./model";
import { checkGameStateInvariants, type GameStateInvariantIssue } from "./invariants";

export type InitialGameStateIssueCode =
  | "INITIAL_CASE_DUPLICATE"
  | "INITIAL_CASE_UNKNOWN"
  | "INITIAL_STORY_DUPLICATE"
  | "INITIAL_STORY_UNKNOWN";

export interface InitialGameStateIssue {
  readonly code: InitialGameStateIssueCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export type CreateInitialGameStateResult =
  | { readonly ok: true; readonly state: GameState }
  | {
      readonly ok: false;
      readonly issues: readonly (InitialGameStateIssue | GameStateInvariantIssue)[];
    };

const collectInitialReferenceIssues = (
  ids: readonly string[],
  collection: "caseIds" | "storyIds",
  exists: (id: string) => boolean,
): InitialGameStateIssue[] => {
  const issues: InitialGameStateIssue[] = [];
  const seen = new Set<string>();
  const kind = collection === "caseIds" ? "case" : "story";

  ids.forEach((id, index) => {
    if (seen.has(id)) {
      issues.push({
        code: collection === "caseIds" ? "INITIAL_CASE_DUPLICATE" : "INITIAL_STORY_DUPLICATE",
        path: ["initial", collection, index],
        message: `Initial ${kind} ID "${id}" is duplicated.`,
      });
    } else {
      seen.add(id);
    }

    if (!exists(id)) {
      issues.push({
        code: collection === "caseIds" ? "INITIAL_CASE_UNKNOWN" : "INITIAL_STORY_UNKNOWN",
        path: ["initial", collection, index],
        message: `Initial ${kind} ID "${id}" does not exist in the content catalog.`,
      });
    }
  });

  return issues;
};

/**
 * Builds a fresh run using only authored initial values. Every mutable container is newly
 * allocated because callers may immediately evolve the returned state independently of the
 * catalog and of other new-game sessions.
 */
export const createInitialGameState = (
  content: Readonly<ContentCatalog>,
): CreateInitialGameStateResult => {
  const referenceIssues = [
    ...collectInitialReferenceIssues(
      content.initial.caseIds,
      "caseIds",
      (caseId) => content.cases[caseId] !== undefined,
    ),
    ...collectInitialReferenceIssues(
      content.initial.storyIds,
      "storyIds",
      (storyId) => content.stories[storyId] !== undefined,
    ),
  ];

  // Detect duplicates before constructing records, where duplicate case IDs would be lost.
  if (referenceIssues.length > 0) {
    return { ok: false, issues: referenceIssues };
  }

  const state: GameState = {
    phase: { type: "playing" },
    attributes: Object.fromEntries(
      Object.entries(content.attributes).map(([attributeId, definition]) => [
        attributeId,
        definition.initial,
      ]),
    ),
    flags: { ...content.initial.flags },
    cases: Object.fromEntries(
      content.initial.caseIds.map((caseId) => [caseId, { status: "pending" }]),
    ),
    pendingStoryIds: [...content.initial.storyIds],
    completedStoryIds: [],
  };

  const invariantResult = checkGameStateInvariants(state, content);
  return invariantResult.ok ? { ok: true, state } : invariantResult;
};
