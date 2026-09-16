import { describe, expect, it } from "vitest";
import type { Condition, GameContentCatalog, Predicate } from "../../src/content/schema";
import { MINIMAL_GAME_CONTENT } from "../../src/content/fixtures/minimalCatalog";
import type { GameState } from "../../src/game/model";
import {
  countResolvedCases,
  evaluateCondition,
  evaluatePredicate,
  findCaseIdsToUnlock,
  findStoryIdsToQueue,
  selectEnding,
  type ProgressionIssue,
  type ProgressionResult,
} from "../../src/game/progression";

const catalogCopy = (): GameContentCatalog => structuredClone(MINIMAL_GAME_CONTENT);

const resolvedProgress = (resolutionId: string, resolvedOrder: number) => ({
  status: "resolved" as const,
  history: [{ nodeId: "assessment", choiceId: "insufficient_evidence" }],
  resolutionId,
  finalChoiceId: "insufficient_evidence",
  snapshot: {
    attributeChanges: [],
    resolvedAt: "2026-09-15T00:00:00.000Z",
    resolvedOrder,
  },
});

const progressedState = (): GameState => ({
  phase: { type: "playing" },
  attributes: { restraint: 55, authority: 45 },
  flags: { first_case_closed: true, second_case_reviewed: false },
  cases: {
    case_001: resolvedProgress("close_with_note", 1),
    case_002: { status: "pending" },
  },
  pendingStoryIds: [],
  completedStoryIds: [],
  storyCheckpoint: null,
});

const valueOf = <T>(result: ProgressionResult<T>): T => {
  if (!result.ok) {
    throw new Error(`Expected success, received: ${JSON.stringify(result.issues)}`);
  }
  return result.value;
};

const issuesOf = <T>(result: ProgressionResult<T>): readonly ProgressionIssue[] => {
  if (result.ok) {
    throw new Error(`Expected failure, received: ${JSON.stringify(result.value)}`);
  }
  return result.issues;
};

describe("progression predicates", () => {
  it("counts resolved cases without maintaining a second counter", () => {
    const state = progressedState();
    expect(countResolvedCases(state)).toBe(1);
    state.cases.case_002 = resolvedProgress("review_required", 2);
    expect(countResolvedCases(state)).toBe(2);
  });

  it.each<[Predicate, boolean]>([
    [{ type: "caseResolved", caseId: "case_001" }, true],
    [{ type: "caseResolved", caseId: "case_001", resolutionId: "close_with_note" }, true],
    [{ type: "caseResolved", caseId: "case_001", resolutionId: "warning" }, false],
    [{ type: "caseResolved", caseId: "case_002" }, false],
    [{ type: "resolvedCountAtLeast", count: 1 }, true],
    [{ type: "resolvedCountAtLeast", count: 2 }, false],
    [{ type: "attributeAtLeast", attributeId: "restraint", value: 55 }, true],
    [{ type: "attributeAtLeast", attributeId: "restraint", value: 56 }, false],
    [{ type: "attributeAtMost", attributeId: "authority", value: 45 }, true],
    [{ type: "attributeAtMost", attributeId: "authority", value: 44 }, false],
    [{ type: "flagEquals", flagId: "first_case_closed", value: true }, true],
    [{ type: "flagEquals", flagId: "second_case_reviewed", value: true }, false],
  ])("evaluates $type predicates", (predicate, expected) => {
    expect(valueOf(evaluatePredicate(progressedState(), predicate, MINIMAL_GAME_CONTENT))).toBe(
      expected,
    );
  });

  it("requires every condition predicate to match", () => {
    const matching: Condition = {
      all: [
        { type: "caseResolved", caseId: "case_001" },
        { type: "attributeAtLeast", attributeId: "restraint", value: 50 },
      ],
    };
    const notMatching: Condition = {
      all: [...matching.all, { type: "flagEquals", flagId: "second_case_reviewed", value: true }],
    };

    expect(valueOf(evaluateCondition(progressedState(), matching, MINIMAL_GAME_CONTENT))).toBe(
      true,
    );
    expect(valueOf(evaluateCondition(progressedState(), notMatching, MINIMAL_GAME_CONTENT))).toBe(
      false,
    );
  });

  it("reports unknown case, resolution, attribute, and flag references", () => {
    const state = progressedState();
    const predicates: Predicate[] = [
      { type: "caseResolved", caseId: "missing_case" },
      { type: "caseResolved", caseId: "case_001", resolutionId: "missing_resolution" },
      { type: "attributeAtLeast", attributeId: "missing_attribute", value: 0 },
      { type: "flagEquals", flagId: "missing_flag", value: false },
    ];

    expect(
      predicates.map(
        (predicate) => issuesOf(evaluatePredicate(state, predicate, MINIMAL_GAME_CONTENT))[0].code,
      ),
    ).toEqual([
      "CASE_REFERENCE_INVALID",
      "RESOLUTION_REFERENCE_INVALID",
      "ATTRIBUTE_REFERENCE_INVALID",
      "FLAG_REFERENCE_INVALID",
    ]);
  });

  it("does not let a false predicate hide a later broken reference", () => {
    const condition: Condition = {
      all: [
        { type: "resolvedCountAtLeast", count: 99 },
        { type: "attributeAtMost", attributeId: "missing_attribute", value: 0 },
      ],
    };

    expect(
      issuesOf(evaluateCondition(progressedState(), condition, MINIMAL_GAME_CONTENT)),
    ).toMatchObject([{ code: "ATTRIBUTE_REFERENCE_INVALID", path: ["all", 1, "attributeId"] }]);
  });
});

describe("progression rule selection", () => {
  it("returns only new unlock targets and deduplicates them across matching rules", () => {
    const catalog = catalogCopy();
    const resolved = { all: [{ type: "caseResolved" as const, caseId: "case_001" }] };
    catalog.unlockRules = [
      { id: "first", when: resolved, caseIds: ["case_001", "case_002", "case_002"] },
      { id: "second", when: resolved, caseIds: ["case_002"] },
    ];
    const state = progressedState();
    delete state.cases.case_002;

    expect(valueOf(findCaseIdsToUnlock(state, catalog))).toEqual(["case_002"]);
    expect(state.cases.case_002).toBeUndefined();
  });

  it("reports invalid unlock targets even when their condition does not match", () => {
    const catalog = catalogCopy();
    catalog.unlockRules = [
      {
        id: "latent_broken_rule",
        when: { all: [{ type: "resolvedCountAtLeast", count: 99 }] },
        caseIds: ["missing_case"],
      },
    ];

    expect(issuesOf(findCaseIdsToUnlock(progressedState(), catalog))).toMatchObject([
      { code: "CASE_REFERENCE_INVALID", path: ["unlockRules", 0, "caseIds", 0] },
    ]);
  });

  it("sorts matching stories by order then rule ID and excludes every seen or duplicate story", () => {
    const catalog = catalogCopy();
    catalog.stories.story_a = structuredClone(catalog.stories.story_after_case_001);
    catalog.stories.story_b = structuredClone(catalog.stories.story_after_case_001);
    catalog.stories.story_seen = structuredClone(catalog.stories.story_after_case_001);
    catalog.stories.story_pending = structuredClone(catalog.stories.story_after_case_001);
    const always = { all: [{ type: "resolvedCountAtLeast" as const, count: 1 }] };
    catalog.storyRules = [
      { id: "z_rule", when: always, storyId: "story_b", order: 10 },
      { id: "a_rule", when: always, storyId: "story_a", order: 10 },
      { id: "seen_rule", when: always, storyId: "story_seen", order: 1 },
      { id: "pending_rule", when: always, storyId: "story_pending", order: 2 },
      { id: "duplicate_later", when: always, storyId: "story_a", order: 20 },
    ];
    const state = progressedState();
    state.pendingStoryIds = ["story_pending"];
    state.completedStoryIds = ["story_seen"];

    expect(valueOf(findStoryIdsToQueue(state, catalog))).toEqual(["story_a", "story_b"]);
  });

  it("reports invalid story targets even when their condition does not match", () => {
    const catalog = catalogCopy();
    catalog.storyRules = [
      {
        id: "latent_broken_rule",
        when: { all: [{ type: "resolvedCountAtLeast", count: 99 }] },
        storyId: "missing_story",
        order: 1,
      },
    ];

    expect(issuesOf(findStoryIdsToQueue(progressedState(), catalog))).toMatchObject([
      { code: "STORY_REFERENCE_INVALID", path: ["storyRules", 0, "storyId"] },
    ]);
  });

  it("selects the highest-priority matching ending and returns null when none match", () => {
    const state = progressedState();
    state.cases.case_002 = resolvedProgress("review_required", 2);
    expect(valueOf(selectEnding(state, MINIMAL_GAME_CONTENT))).toEqual({
      endingId: "balanced",
      storyId: "ending_balanced",
    });

    expect(valueOf(selectEnding(progressedState(), MINIMAL_GAME_CONTENT))).toBeNull();
  });

  it("uses ending ID only as a deterministic tie-break for duplicate priorities", () => {
    const catalog = catalogCopy();
    const always = { all: [{ type: "resolvedCountAtLeast" as const, count: 1 }] };
    catalog.endings = {
      zeta: { priority: 50, when: always, storyId: "ending_fallback" },
      alpha: { priority: 50, when: always, storyId: "ending_balanced" },
    };

    expect(valueOf(selectEnding(progressedState(), catalog))).toEqual({
      endingId: "alpha",
      storyId: "ending_balanced",
    });
  });

  it("reports an unknown or already-seen selected ending story", () => {
    const missing = catalogCopy();
    missing.endings.balanced.storyId = "missing_story";
    expect(issuesOf(selectEnding(progressedState(), missing)).map((entry) => entry.code)).toContain(
      "STORY_REFERENCE_INVALID",
    );

    const state = progressedState();
    state.cases.case_002 = resolvedProgress("review_required", 2);
    state.completedStoryIds = ["ending_balanced"];
    expect(
      issuesOf(selectEnding(state, MINIMAL_GAME_CONTENT)).map((entry) => entry.code),
    ).toContain("ENDING_STORY_ALREADY_SEEN");
  });

  it("does not mutate state, content, rule arrays, or returned values", () => {
    const state = progressedState();
    const catalog = catalogCopy();
    const beforeState = structuredClone(state);
    const beforeCatalog = structuredClone(catalog);

    const unlocks = valueOf(findCaseIdsToUnlock(state, catalog));
    const stories = valueOf(findStoryIdsToQueue(state, catalog));
    const ending = valueOf(selectEnding(state, catalog));

    expect(state).toEqual(beforeState);
    expect(catalog).toEqual(beforeCatalog);
    expect(unlocks).not.toBe(catalog.unlockRules[0].caseIds);
    expect(stories).not.toBe(state.pendingStoryIds);
    expect(ending).toBeNull();
  });
});
