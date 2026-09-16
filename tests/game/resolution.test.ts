import { describe, expect, it } from "vitest";
import type { GameContentCatalog } from "../../src/content/schema";
import { MINIMAL_GAME_CONTENT } from "../../src/content/fixtures/minimalCatalog";
import type { TransitionResult } from "../../src/game/commands";
import { createInitialGameState } from "../../src/game/initialization";
import type { GameState } from "../../src/game/model";
import { resolveFinalChoice, type ResolutionChoiceInput } from "../../src/game/resolution";
import { transition } from "../../src/game/transition";

const NOW = "2026-09-15T08:30:00.000Z";

const catalogCopy = (): GameContentCatalog => structuredClone(MINIMAL_GAME_CONTENT);

const deepFreeze = <T>(value: T): Readonly<T> => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return value;
};

const initialState = (content: Readonly<GameContentCatalog>): GameState => {
  const result = createInitialGameState(content);
  if (!result.ok) {
    throw new Error(`Expected valid initial state: ${JSON.stringify(result.issues)}`);
  }
  return result.state;
};

const expectSuccess = (result: TransitionResult): Extract<TransitionResult, { ok: true }> => {
  if (!result.ok) {
    throw new Error(`Expected success, received ${result.code}: ${result.message}`);
  }
  return result;
};

const expectContentFailure = (result: TransitionResult): void => {
  expect(result).toMatchObject({ ok: false, code: "CONTENT_INVALID" });
};

const startFirstCase = (
  content: Readonly<GameContentCatalog>,
  state = initialState(content),
): GameState =>
  expectSuccess(
    transition(state, { type: "startCase", caseId: "case_001" }, content, { nowIso: NOW }),
  ).nextState;

const choose = (
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
  nodeId: string,
  choiceId: string,
  nowIso = NOW,
): TransitionResult =>
  transition(state, { type: "chooseOption", caseId: "case_001", nodeId, choiceId }, content, {
    nowIso,
  });

describe("final choice settlement", () => {
  it("atomically resolves a direct choice with effects, snapshot, unlock, story, and feedback", () => {
    const state = startFirstCase(MINIMAL_GAME_CONTENT);
    const before = structuredClone(state);
    deepFreeze(state);

    const result = expectSuccess(
      choose(state, MINIMAL_GAME_CONTENT, "assessment", "insufficient_evidence"),
    );
    const progress = result.nextState.cases.case_001;

    expect(state).toEqual(before);
    expect(progress).toMatchObject({
      status: "resolved",
      history: [{ nodeId: "assessment", choiceId: "insufficient_evidence" }],
      resolutionId: "close_with_note",
      finalChoiceId: "insufficient_evidence",
      snapshot: {
        resolvedAt: NOW,
        resolvedOrder: 1,
      },
    });
    expect(result.nextState.attributes).toEqual({ restraint: 53, authority: 48 });
    expect(result.nextState.flags.first_case_closed).toBe(true);
    expect(result.nextState.cases.case_002).toEqual({ status: "pending" });
    expect(result.nextState.pendingStoryIds).toEqual(["story_after_case_001"]);
    expect(result.nextState.pendingStoryIds).not.toBe(state.pendingStoryIds);
    expect(result.nextState.completedStoryIds).not.toBe(state.completedStoryIds);
    expect(result.nextState.phase).toEqual({ type: "playing" });
    expect(result.feedback).toEqual([
      {
        type: "attributeFeedback",
        source: { type: "case", caseId: "case_001" },
        changes: [
          { attributeId: "authority", before: 50, after: 48, actualDelta: -2 },
          { attributeId: "restraint", before: 50, after: 53, actualDelta: 3 },
        ],
      },
    ]);
  });

  it("retains intermediate history before appending the final choice", () => {
    const started = startFirstCase(MINIMAL_GAME_CONTENT);
    const intermediate = expectSuccess(
      choose(started, MINIMAL_GAME_CONTENT, "assessment", "confirm_violation"),
    ).nextState;
    const settled = expectSuccess(
      choose(intermediate, MINIMAL_GAME_CONTENT, "disposition", "formal_warning"),
    ).nextState;

    expect(settled.cases.case_001).toMatchObject({
      status: "resolved",
      resolutionId: "warning",
      history: [
        { nodeId: "assessment", choiceId: "confirm_violation" },
        { nodeId: "disposition", choiceId: "formal_warning" },
      ],
    });
  });

  it("uses deterministic attribute order and retains zero actual changes at both clamps", () => {
    const content = catalogCopy();
    content.attributes.restraint.initial = 100;
    content.attributes.authority.initial = 0;
    content.cases.case_001.resolutions.close_with_note.effects.attributeDeltas = {
      restraint: 5,
      authority: -5,
    };

    const result = expectSuccess(
      choose(startFirstCase(content), content, "assessment", "insufficient_evidence"),
    );
    const progress = result.nextState.cases.case_001;
    if (progress.status !== "resolved") {
      throw new Error("Expected resolved progress.");
    }

    expect(progress.snapshot.attributeChanges).toEqual([
      { attributeId: "authority", before: 0, after: 0, actualDelta: 0 },
      { attributeId: "restraint", before: 100, after: 100, actualDelta: 0 },
    ]);
    expect(result.feedback[0]).toMatchObject({
      type: "attributeFeedback",
      changes: progress.snapshot.attributeChanges,
    });
  });

  it("deep-copies factual attribute changes and final history", () => {
    const content = catalogCopy();
    const state = startFirstCase(content);
    const priorHistory = state.cases.case_001;
    if (priorHistory.status !== "active") {
      throw new Error("Expected active progress.");
    }

    const result = expectSuccess(choose(state, content, "assessment", "insufficient_evidence"));
    const progress = result.nextState.cases.case_001;
    if (progress.status !== "resolved") {
      throw new Error("Expected resolved progress.");
    }
    expect(progress.history).not.toBe(priorHistory.history);
    expect(progress.snapshot.attributeChanges).not.toBe(
      result.feedback[0].type === "attributeFeedback" ? result.feedback[0].changes : [],
    );
    expect(progress.snapshot).not.toHaveProperty("verdict");
    expect(progress.snapshot).not.toHaveProperty("result");
  });

  it("rejects a repeated final choice without changing the committed result", () => {
    const settled = expectSuccess(
      choose(
        startFirstCase(MINIMAL_GAME_CONTENT),
        MINIMAL_GAME_CONTENT,
        "assessment",
        "insufficient_evidence",
      ),
    ).nextState;
    const afterStory = expectSuccess(
      transition(
        settled,
        { type: "completeStory", storyId: "story_after_case_001" },
        MINIMAL_GAME_CONTENT,
        { nowIso: NOW },
      ),
    ).nextState;
    const before = structuredClone(afterStory);
    deepFreeze(afterStory);

    const repeated = choose(
      afterStory,
      MINIMAL_GAME_CONTENT,
      "assessment",
      "insufficient_evidence",
    );
    expect(repeated).toMatchObject({ ok: false, code: "CASE_ALREADY_RESOLVED" });
    expect(afterStory).toEqual(before);
  });

  it("derives resolvedOrder from the number of previously resolved cases", () => {
    const state = initialState(MINIMAL_GAME_CONTENT);
    state.attributes.restraint = 55;
    state.flags.second_case_reviewed = true;
    state.cases.case_002 = {
      status: "resolved",
      history: [{ nodeId: "assessment", choiceId: "request_review" }],
      resolutionId: "review_required",
      finalChoiceId: "request_review",
      snapshot: {
        attributeChanges: [
          {
            attributeId: "restraint",
            before: 50,
            after: 55,
            actualDelta: 5,
          },
        ],
        resolvedAt: "2026-09-15T08:00:00.000Z",
        resolvedOrder: 1,
      },
    };

    const settled = expectSuccess(
      choose(
        startFirstCase(MINIMAL_GAME_CONTENT, state),
        MINIMAL_GAME_CONTENT,
        "assessment",
        "insufficient_evidence",
      ),
    ).nextState;
    const progress = settled.cases.case_001;
    if (progress.status !== "resolved") {
      throw new Error("Expected resolved progress.");
    }
    expect(progress.snapshot.resolvedOrder).toBe(2);
  });
});

describe("resolveFinalChoice trust boundary", () => {
  it("derives final choice and resolution IDs only from the referenced content choice", () => {
    const state = startFirstCase(MINIMAL_GAME_CONTENT);

    const result = resolveFinalChoice(
      state,
      { caseId: "case_001", nodeId: "assessment", choiceId: "insufficient_evidence" },
      MINIMAL_GAME_CONTENT,
      { nowIso: NOW },
    );

    if (!result.ok) {
      throw new Error(`Expected direct settlement success: ${JSON.stringify(result.issues)}`);
    }
    const progress = result.nextState.cases.case_001;
    expect(progress).toMatchObject({
      status: "resolved",
      resolutionId: "close_with_note",
      finalChoiceId: "insufficient_evidence",
    });
  });

  it.each<{
    readonly name: string;
    readonly input: ResolutionChoiceInput;
    readonly code: string;
  }>([
    {
      name: "a choice forged from a different node",
      input: { caseId: "case_001", nodeId: "disposition", choiceId: "formal_warning" },
      code: "CASE_PROGRESS_INVALID",
    },
    {
      name: "an unknown choice ID",
      input: { caseId: "case_001", nodeId: "assessment", choiceId: "forged_choice" },
      code: "CHOICE_REFERENCE_INVALID",
    },
    {
      name: "a non-resolution choice",
      input: { caseId: "case_001", nodeId: "assessment", choiceId: "confirm_violation" },
      code: "CHOICE_REFERENCE_INVALID",
    },
  ])("rejects $name without modifying input", ({ input, code }) => {
    const state = startFirstCase(MINIMAL_GAME_CONTENT);
    const before = structuredClone(state);
    deepFreeze(state);

    const result = resolveFinalChoice(state, input, MINIMAL_GAME_CONTENT, { nowIso: NOW });

    expect(result).toMatchObject({ ok: false, issues: [{ code }] });
    expect(state).toEqual(before);
  });
});

describe("settlement progression pipeline", () => {
  it("deduplicates case unlocks across rules while preserving existing progress", () => {
    const content = catalogCopy();
    content.cases.case_003 = structuredClone(content.cases.case_002);
    content.cases.case_003.id = "case_003";
    const resolved = { all: [{ type: "caseResolved" as const, caseId: "case_001" }] };
    content.unlockRules = [
      { id: "first", when: resolved, caseIds: ["case_002", "case_003", "case_003"] },
      { id: "second", when: resolved, caseIds: ["case_002", "case_003"] },
    ];

    const settled = expectSuccess(
      choose(startFirstCase(content), content, "assessment", "insufficient_evidence"),
    ).nextState;

    expect(settled.cases.case_002).toEqual({ status: "pending" });
    expect(settled.cases.case_003).toEqual({ status: "pending" });
    expect(Object.keys(settled.cases).filter((caseId) => caseId === "case_003")).toHaveLength(1);
  });

  it("queues unseen stories in stable rule order", () => {
    const content = catalogCopy();
    const story = content.stories.story_after_case_001;
    content.stories.story_a = structuredClone(story);
    content.stories.story_b = structuredClone(story);
    content.stories.story_seen = structuredClone(story);
    const resolved = { all: [{ type: "caseResolved" as const, caseId: "case_001" }] };
    content.storyRules = [
      { id: "z_rule", when: resolved, storyId: "story_b", order: 10 },
      { id: "a_rule", when: resolved, storyId: "story_a", order: 10 },
      { id: "seen", when: resolved, storyId: "story_seen", order: 1 },
      { id: "duplicate", when: resolved, storyId: "story_a", order: 20 },
    ];
    const state = initialState(content);
    state.completedStoryIds = ["story_seen"];

    const settled = expectSuccess(
      choose(startFirstCase(content, state), content, "assessment", "insufficient_evidence"),
    ).nextState;
    expect(settled.pendingStoryIds).toEqual(["story_a", "story_b"]);
  });

  it("selects the highest-priority ending after unlocks and ordinary stories", () => {
    const content = catalogCopy();
    const afterOne = { all: [{ type: "resolvedCountAtLeast" as const, count: 1 }] };
    content.endings.balanced.when = afterOne;
    content.endings.balanced.priority = 100;
    content.endings.fallback.when = afterOne;
    content.endings.fallback.priority = 10;

    const settled = expectSuccess(
      choose(startFirstCase(content), content, "assessment", "insufficient_evidence"),
    ).nextState;

    expect(settled.phase).toEqual({ type: "ending", endingId: "balanced" });
    expect(settled.pendingStoryIds).toEqual(["story_after_case_001", "ending_balanced"]);
    expect(settled.cases.case_002).toEqual({ status: "pending" });
  });
});

describe("atomic settlement failures", () => {
  const cases: {
    readonly name: string;
    readonly mutate: (content: GameContentCatalog) => void;
  }[] = [
    {
      name: "missing resolution",
      mutate: (content) => {
        delete content.cases.case_001.resolutions.close_with_note;
      },
    },
    {
      name: "unknown resolution attribute",
      mutate: (content) => {
        content.cases.case_001.resolutions.close_with_note.effects.attributeDeltas.missing = 1;
      },
    },
    {
      name: "unknown resolution flag",
      mutate: (content) => {
        content.cases.case_001.resolutions.close_with_note.effects.setFlags.missing = true;
      },
    },
    {
      name: "invalid unlock rule predicate",
      mutate: (content) => {
        content.unlockRules[0].when = {
          all: [{ type: "attributeAtLeast", attributeId: "missing", value: 0 }],
        };
      },
    },
    {
      name: "unknown unlock target",
      mutate: (content) => {
        content.unlockRules[0].caseIds = ["missing_case"];
      },
    },
    {
      name: "unknown story target",
      mutate: (content) => {
        content.storyRules[0].storyId = "missing_story";
      },
    },
    {
      name: "unknown ending story",
      mutate: (content) => {
        content.endings.fallback.storyId = "missing_story";
      },
    },
    {
      name: "ending story reused by an ordinary story rule",
      mutate: (content) => {
        content.endings.balanced.when = {
          all: [{ type: "resolvedCountAtLeast", count: 1 }],
        };
        content.endings.balanced.storyId = "story_after_case_001";
      },
    },
  ];

  it.each(cases)("fails atomically for $name", ({ mutate }) => {
    const content = catalogCopy();
    mutate(content);
    const state = startFirstCase(content);
    const before = structuredClone(state);
    deepFreeze(state);

    const result = choose(state, content, "assessment", "insufficient_evidence");

    expectContentFailure(result);
    expect(state).toEqual(before);
  });

  it("rejects an invalid settlement timestamp through output invariants", () => {
    const state = startFirstCase(MINIMAL_GAME_CONTENT);
    const before = structuredClone(state);

    expectContentFailure(
      choose(state, MINIMAL_GAME_CONTENT, "assessment", "insufficient_evidence", "not-an-iso-date"),
    );
    expect(state).toEqual(before);
  });
});
