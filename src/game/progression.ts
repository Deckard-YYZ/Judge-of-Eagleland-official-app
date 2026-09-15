import type {
  CaseId,
  Condition,
  ContentCatalog,
  EndingId,
  Predicate,
  StoryId,
} from "../content/schema";
import type { GameState } from "./model";

export type ProgressionIssueCode =
  | "CASE_REFERENCE_INVALID"
  | "RESOLUTION_REFERENCE_INVALID"
  | "ATTRIBUTE_REFERENCE_INVALID"
  | "FLAG_REFERENCE_INVALID"
  | "STORY_REFERENCE_INVALID"
  | "ENDING_STORY_ALREADY_SEEN";

export interface ProgressionIssue {
  readonly code: ProgressionIssueCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export type ProgressionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ProgressionIssue[] };

export interface EndingSelection {
  readonly endingId: EndingId;
  readonly storyId: StoryId;
}

type Path = readonly (string | number)[];

const success = <T>(value: T): ProgressionResult<T> => ({ ok: true, value });
const failure = <T>(issues: readonly ProgressionIssue[]): ProgressionResult<T> => ({
  ok: false,
  issues,
});

const issue = (code: ProgressionIssueCode, path: Path, message: string): ProgressionIssue => ({
  code,
  path,
  message,
});

const compareIds = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const countResolvedCases = (state: Readonly<GameState>): number =>
  Object.values(state.cases).filter((progress) => progress.status === "resolved").length;

const evaluatePredicateAtPath = (
  state: Readonly<GameState>,
  predicate: Predicate,
  content: Readonly<ContentCatalog>,
  path: Path,
): ProgressionResult<boolean> => {
  switch (predicate.type) {
    case "caseResolved": {
      const definition = content.cases[predicate.caseId];
      if (!definition) {
        return failure([
          issue(
            "CASE_REFERENCE_INVALID",
            [...path, "caseId"],
            `Predicate references unknown case "${predicate.caseId}".`,
          ),
        ]);
      }
      if (predicate.resolutionId !== undefined && !definition.resolutions[predicate.resolutionId]) {
        return failure([
          issue(
            "RESOLUTION_REFERENCE_INVALID",
            [...path, "resolutionId"],
            `Predicate references unknown resolution "${predicate.resolutionId}" for case "${predicate.caseId}".`,
          ),
        ]);
      }

      const progress = state.cases[predicate.caseId];
      if (progress?.status === "resolved" && !definition.resolutions[progress.resolutionId]) {
        return failure([
          issue(
            "RESOLUTION_REFERENCE_INVALID",
            ["cases", predicate.caseId, "resolutionId"],
            `Resolved case "${predicate.caseId}" references unknown resolution "${progress.resolutionId}".`,
          ),
        ]);
      }

      return success(
        progress?.status === "resolved" &&
          (predicate.resolutionId === undefined ||
            progress.resolutionId === predicate.resolutionId),
      );
    }
    case "resolvedCountAtLeast":
      return success(countResolvedCases(state) >= predicate.count);
    case "attributeAtLeast":
    case "attributeAtMost": {
      if (!content.attributes[predicate.attributeId]) {
        return failure([
          issue(
            "ATTRIBUTE_REFERENCE_INVALID",
            [...path, "attributeId"],
            `Predicate references unknown attribute "${predicate.attributeId}".`,
          ),
        ]);
      }
      if (!Object.hasOwn(state.attributes, predicate.attributeId)) {
        return failure([
          issue(
            "ATTRIBUTE_REFERENCE_INVALID",
            ["attributes", predicate.attributeId],
            `State is missing declared attribute "${predicate.attributeId}".`,
          ),
        ]);
      }

      const value = state.attributes[predicate.attributeId];
      return success(
        predicate.type === "attributeAtLeast" ? value >= predicate.value : value <= predicate.value,
      );
    }
    case "flagEquals": {
      if (!Object.hasOwn(content.initial.flags, predicate.flagId)) {
        return failure([
          issue(
            "FLAG_REFERENCE_INVALID",
            [...path, "flagId"],
            `Predicate references unknown flag "${predicate.flagId}".`,
          ),
        ]);
      }
      if (!Object.hasOwn(state.flags, predicate.flagId)) {
        return failure([
          issue(
            "FLAG_REFERENCE_INVALID",
            ["flags", predicate.flagId],
            `State is missing declared flag "${predicate.flagId}".`,
          ),
        ]);
      }
      return success(state.flags[predicate.flagId] === predicate.value);
    }
  }
};

export const evaluatePredicate = (
  state: Readonly<GameState>,
  predicate: Predicate,
  content: Readonly<ContentCatalog>,
): ProgressionResult<boolean> => evaluatePredicateAtPath(state, predicate, content, []);

const evaluateConditionAtPath = (
  state: Readonly<GameState>,
  condition: Condition,
  content: Readonly<ContentCatalog>,
  path: Path,
): ProgressionResult<boolean> => {
  let matches = true;
  const issues: ProgressionIssue[] = [];

  // Evaluate every predicate so a preceding false value cannot hide broken content references.
  condition.all.forEach((predicate, index) => {
    const result = evaluatePredicateAtPath(state, predicate, content, [...path, "all", index]);
    if (result.ok) {
      matches = matches && result.value;
    } else {
      issues.push(...result.issues);
    }
  });

  return issues.length > 0 ? failure(issues) : success(matches);
};

export const evaluateCondition = (
  state: Readonly<GameState>,
  condition: Condition,
  content: Readonly<ContentCatalog>,
): ProgressionResult<boolean> => evaluateConditionAtPath(state, condition, content, []);

export const findCaseIdsToUnlock = (
  state: Readonly<GameState>,
  content: Readonly<ContentCatalog>,
): ProgressionResult<readonly CaseId[]> => {
  const issues: ProgressionIssue[] = [];
  const seen = new Set(Object.keys(state.cases));
  const caseIds: CaseId[] = [];

  content.unlockRules.forEach((rule, ruleIndex) => {
    const condition = evaluateConditionAtPath(state, rule.when, content, [
      "unlockRules",
      ruleIndex,
      "when",
    ]);
    if (!condition.ok) {
      issues.push(...condition.issues);
    }

    rule.caseIds.forEach((caseId, caseIndex) => {
      if (!content.cases[caseId]) {
        issues.push(
          issue(
            "CASE_REFERENCE_INVALID",
            ["unlockRules", ruleIndex, "caseIds", caseIndex],
            `Unlock rule "${rule.id}" references unknown case "${caseId}".`,
          ),
        );
      } else if (condition.ok && condition.value && !seen.has(caseId)) {
        seen.add(caseId);
        caseIds.push(caseId);
      }
    });
  });

  return issues.length > 0 ? failure(issues) : success(caseIds);
};

export const findStoryIdsToQueue = (
  state: Readonly<GameState>,
  content: Readonly<ContentCatalog>,
): ProgressionResult<readonly StoryId[]> => {
  const issues: ProgressionIssue[] = [];
  const matchingRules: {
    readonly index: number;
    readonly rule: ContentCatalog["storyRules"][number];
  }[] = [];

  content.storyRules.forEach((rule, ruleIndex) => {
    const condition = evaluateConditionAtPath(state, rule.when, content, [
      "storyRules",
      ruleIndex,
      "when",
    ]);
    if (!condition.ok) {
      issues.push(...condition.issues);
    }
    if (!content.stories[rule.storyId]) {
      issues.push(
        issue(
          "STORY_REFERENCE_INVALID",
          ["storyRules", ruleIndex, "storyId"],
          `Story rule "${rule.id}" references unknown story "${rule.storyId}".`,
        ),
      );
    } else if (condition.ok && condition.value) {
      matchingRules.push({ index: ruleIndex, rule });
    }
  });

  if (issues.length > 0) {
    return failure(issues);
  }

  matchingRules.sort(
    (left, right) =>
      left.rule.order - right.rule.order ||
      compareIds(left.rule.id, right.rule.id) ||
      left.index - right.index,
  );

  const seen = new Set([...state.pendingStoryIds, ...state.completedStoryIds]);
  const storyIds: StoryId[] = [];
  for (const { rule } of matchingRules) {
    if (!seen.has(rule.storyId)) {
      seen.add(rule.storyId);
      storyIds.push(rule.storyId);
    }
  }

  return success(storyIds);
};

export const selectEnding = (
  state: Readonly<GameState>,
  content: Readonly<ContentCatalog>,
): ProgressionResult<EndingSelection | null> => {
  const issues: ProgressionIssue[] = [];
  const matches: EndingSelection[] = [];

  for (const [endingId, ending] of Object.entries(content.endings)) {
    const condition = evaluateConditionAtPath(state, ending.when, content, [
      "endings",
      endingId,
      "when",
    ]);
    if (!condition.ok) {
      issues.push(...condition.issues);
    }
    if (!content.stories[ending.storyId]) {
      issues.push(
        issue(
          "STORY_REFERENCE_INVALID",
          ["endings", endingId, "storyId"],
          `Ending "${endingId}" references unknown story "${ending.storyId}".`,
        ),
      );
    } else if (condition.ok && condition.value) {
      matches.push({ endingId, storyId: ending.storyId });
    }
  }

  if (issues.length > 0) {
    return failure(issues);
  }

  // Duplicate priorities remain invalid content; the ID tie-break only keeps runtime behavior deterministic.
  matches.sort(
    (left, right) =>
      content.endings[right.endingId].priority - content.endings[left.endingId].priority ||
      compareIds(left.endingId, right.endingId),
  );

  const selected = matches[0];
  if (!selected) {
    return success(null);
  }
  if (
    state.pendingStoryIds.includes(selected.storyId) ||
    state.completedStoryIds.includes(selected.storyId)
  ) {
    return failure([
      issue(
        "ENDING_STORY_ALREADY_SEEN",
        ["endings", selected.endingId, "storyId"],
        `Selected ending story "${selected.storyId}" is already pending or completed.`,
      ),
    ]);
  }

  return success({ ...selected });
};
