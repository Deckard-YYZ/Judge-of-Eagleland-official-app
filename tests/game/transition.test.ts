import { describe, expect, it } from "vitest";
import type { ContentCatalog } from "../../src/content/schema";
import { MINIMAL_CATALOG } from "../../src/content/fixtures/minimalCatalog";
import type { TransitionErrorCode, TransitionResult } from "../../src/game/commands";
import { createInitialGameState } from "../../src/game/initialization";
import type { GameState } from "../../src/game/model";
import { transition } from "../../src/game/transition";

const NOW = "2026-09-15T00:00:00.000Z";

const catalogCopy = (): ContentCatalog => structuredClone(MINIMAL_CATALOG);

const initialState = (content: Readonly<ContentCatalog> = MINIMAL_CATALOG): GameState => {
  const result = createInitialGameState(content);
  if (!result.ok) {
    throw new Error(`Expected a valid initial state: ${JSON.stringify(result.issues)}`);
  }
  return result.state;
};

const deepFreeze = <T>(value: T): Readonly<T> => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return value;
};

const nextStateOf = (result: TransitionResult): GameState => {
  if (!result.ok) {
    throw new Error(`Expected success, received ${result.code}: ${result.message}`);
  }
  return result.nextState;
};

const expectFailure = (result: TransitionResult, code: TransitionErrorCode): void => {
  expect(result).toMatchObject({ ok: false, code });
};

const activeState = (): GameState => {
  const state = initialState();
  state.cases.case_001 = { status: "active", currentNodeId: "assessment", history: [] };
  return state;
};

const resolvedStateWithPendingStory = (): GameState => ({
  phase: { type: "playing" },
  attributes: { restraint: 53, authority: 48 },
  flags: { first_case_closed: true, second_case_reviewed: false },
  cases: {
    case_001: {
      status: "resolved",
      history: [{ nodeId: "assessment", choiceId: "insufficient_evidence" }],
      resolutionId: "close_with_note",
      snapshot: {
        caseTitle: "第 001 号：夜间档案室事件",
        finalChoiceText: "现有材料不足以支持进一步处分",
        verdict: [{ type: "paragraph", text: "保留程序违规记录，本次不追加处分。" }],
        result: [{ type: "paragraph", text: "档案室接受了决定，同时提出修订外借登记流程。" }],
        attributeChanges: [
          {
            attributeId: "restraint",
            label: "克制",
            before: 50,
            after: 53,
            actualDelta: 3,
          },
          {
            attributeId: "authority",
            label: "权威",
            before: 50,
            after: 48,
            actualDelta: -2,
          },
        ],
        resolvedAt: NOW,
        resolvedOrder: 1,
      },
    },
  },
  pendingStoryIds: ["story_after_case_001"],
  completedStoryIds: [],
});

describe("transition startCase", () => {
  it("starts a pending case at its authored start node without modifying the input", () => {
    const state = initialState();
    const before = structuredClone(state);
    deepFreeze(state);

    const nextState = nextStateOf(
      transition(state, { type: "startCase", caseId: "case_001" }, MINIMAL_CATALOG, {
        nowIso: NOW,
      }),
    );

    expect(state).toEqual(before);
    expect(nextState).not.toBe(state);
    expect(nextState.cases).not.toBe(state.cases);
    expect(nextState.cases.case_001).toEqual({
      status: "active",
      currentNodeId: "assessment",
      history: [],
    });
  });

  it("prioritizes finished phase over story blocking", () => {
    const ending = initialState();
    ending.phase = { type: "ending", endingId: "balanced" };
    ending.pendingStoryIds = ["ending_balanced"];
    expectFailure(
      transition(ending, { type: "startCase", caseId: "case_001" }, MINIMAL_CATALOG, {
        nowIso: NOW,
      }),
      "RUN_FINISHED",
    );

    const ended = initialState();
    ended.phase = { type: "ended", endingId: "fallback" };
    ended.completedStoryIds = ["ending_fallback"];
    expectFailure(
      transition(ended, { type: "startCase", caseId: "case_001" }, MINIMAL_CATALOG, {
        nowIso: NOW,
      }),
      "RUN_FINISHED",
    );
  });

  it("blocks case commands while a story is pending", () => {
    const state = initialState();
    state.pendingStoryIds = ["story_after_case_001"];

    expectFailure(
      transition(state, { type: "startCase", caseId: "case_001" }, MINIMAL_CATALOG, {
        nowIso: NOW,
      }),
      "STORY_BLOCKING",
    );
  });

  it("rejects locked, already active, and resolved cases with distinct codes", () => {
    const locked = initialState();
    expectFailure(
      transition(locked, { type: "startCase", caseId: "case_002" }, MINIMAL_CATALOG, {
        nowIso: NOW,
      }),
      "CASE_LOCKED",
    );

    const active = activeState();
    expectFailure(
      transition(active, { type: "startCase", caseId: "case_001" }, MINIMAL_CATALOG, {
        nowIso: NOW,
      }),
      "CASE_ALREADY_STARTED",
    );

    const resolved = resolvedStateWithPendingStory();
    resolved.pendingStoryIds = [];
    expectFailure(
      transition(resolved, { type: "startCase", caseId: "case_001" }, MINIMAL_CATALOG, {
        nowIso: NOW,
      }),
      "CASE_ALREADY_RESOLVED",
    );
  });

  it("reports missing unlocked definitions and start nodes as invalid content", () => {
    const missingDefinition = catalogCopy();
    delete missingDefinition.cases.case_001;
    expectFailure(
      transition(initialState(), { type: "startCase", caseId: "case_001" }, missingDefinition, {
        nowIso: NOW,
      }),
      "CONTENT_INVALID",
    );

    const missingStart = catalogCopy();
    missingStart.cases.case_001.startNodeId = "missing_node";
    expectFailure(
      transition(initialState(), { type: "startCase", caseId: "case_001" }, missingStart, {
        nowIso: NOW,
      }),
      "CONTENT_INVALID",
    );
  });
});

describe("transition chooseOption node targets", () => {
  it("applies finished, story-blocking, and locked guards before choice validation", () => {
    const ending = activeState();
    ending.phase = { type: "ending", endingId: "balanced" };
    ending.pendingStoryIds = ["ending_balanced"];
    expectFailure(
      transition(
        ending,
        { type: "chooseOption", caseId: "case_001", nodeId: "assessment", choiceId: "bad" },
        MINIMAL_CATALOG,
        { nowIso: NOW },
      ),
      "RUN_FINISHED",
    );

    const storyBlocking = activeState();
    storyBlocking.pendingStoryIds = ["story_after_case_001"];
    expectFailure(
      transition(
        storyBlocking,
        { type: "chooseOption", caseId: "case_001", nodeId: "assessment", choiceId: "bad" },
        MINIMAL_CATALOG,
        { nowIso: NOW },
      ),
      "STORY_BLOCKING",
    );

    expectFailure(
      transition(
        activeState(),
        { type: "chooseOption", caseId: "case_002", nodeId: "assessment", choiceId: "bad" },
        MINIMAL_CATALOG,
        { nowIso: NOW },
      ),
      "CASE_LOCKED",
    );
  });

  it("rejects pending and resolved cases before inspecting a choice", () => {
    expectFailure(
      transition(
        initialState(),
        { type: "chooseOption", caseId: "case_001", nodeId: "assessment", choiceId: "bad" },
        MINIMAL_CATALOG,
        { nowIso: NOW },
      ),
      "INVALID_CHOICE",
    );

    const resolved = resolvedStateWithPendingStory();
    resolved.pendingStoryIds = [];
    expectFailure(
      transition(
        resolved,
        { type: "chooseOption", caseId: "case_001", nodeId: "assessment", choiceId: "bad" },
        MINIMAL_CATALOG,
        { nowIso: NOW },
      ),
      "CASE_ALREADY_RESOLVED",
    );
  });

  it("prioritizes stale node detection over missing choice detection", () => {
    expectFailure(
      transition(
        activeState(),
        { type: "chooseOption", caseId: "case_001", nodeId: "disposition", choiceId: "bad" },
        MINIMAL_CATALOG,
        { nowIso: NOW },
      ),
      "STALE_CHOICE",
    );

    expectFailure(
      transition(
        activeState(),
        { type: "chooseOption", caseId: "case_001", nodeId: "assessment", choiceId: "bad" },
        MINIMAL_CATALOG,
        { nowIso: NOW },
      ),
      "INVALID_CHOICE",
    );
  });

  it("appends history and advances to a node without changing global state", () => {
    const state = activeState();
    const before = structuredClone(state);
    const frozen = deepFreeze(state);

    const first = nextStateOf(
      transition(
        frozen,
        {
          type: "chooseOption",
          caseId: "case_001",
          nodeId: "assessment",
          choiceId: "confirm_violation",
        },
        MINIMAL_CATALOG,
        { nowIso: NOW },
      ),
    );
    const second = nextStateOf(
      transition(
        before,
        {
          type: "chooseOption",
          caseId: "case_001",
          nodeId: "assessment",
          choiceId: "confirm_violation",
        },
        MINIMAL_CATALOG,
        { nowIso: "2030-01-01T00:00:00.000Z" },
      ),
    );

    expect(state).toEqual(before);
    expect(first).toEqual(second);
    expect(first.cases.case_001).toEqual({
      status: "active",
      currentNodeId: "disposition",
      history: [{ nodeId: "assessment", choiceId: "confirm_violation" }],
    });
    expect(first.attributes).toEqual(before.attributes);
    expect(first.flags).toEqual(before.flags);
    expect(first.pendingStoryIds).toEqual(before.pendingStoryIds);
    expect(first.completedStoryIds).toEqual(before.completedStoryIds);
    expect(first.phase).toEqual(before.phase);
  });

  it("reports missing current and target nodes as invalid content", () => {
    const missingCurrent = activeState();
    missingCurrent.cases.case_001 = {
      status: "active",
      currentNodeId: "missing_node",
      history: [],
    };
    expectFailure(
      transition(
        missingCurrent,
        { type: "chooseOption", caseId: "case_001", nodeId: "missing_node", choiceId: "bad" },
        MINIMAL_CATALOG,
        { nowIso: NOW },
      ),
      "CONTENT_INVALID",
    );

    const missingTarget = catalogCopy();
    const choice = missingTarget.cases.case_001.nodes.assessment.choices.find(
      (candidate) => candidate.id === "confirm_violation",
    );
    if (!choice || choice.target.type !== "node") {
      throw new Error("Expected node choice fixture.");
    }
    choice.target.nodeId = "missing_node";
    expectFailure(
      transition(
        activeState(),
        {
          type: "chooseOption",
          caseId: "case_001",
          nodeId: "assessment",
          choiceId: "confirm_violation",
        },
        missingTarget,
        { nowIso: NOW },
      ),
      "CONTENT_INVALID",
    );
  });
});

describe("transition completeStory", () => {
  it("rejects ended runs, unknown stories, and non-head completions in that order", () => {
    const ended = initialState();
    ended.phase = { type: "ended", endingId: "fallback" };
    ended.completedStoryIds = ["ending_fallback"];
    expectFailure(
      transition(ended, { type: "completeStory", storyId: "missing_story" }, MINIMAL_CATALOG, {
        nowIso: NOW,
      }),
      "RUN_FINISHED",
    );

    const state = initialState();
    const content = catalogCopy();
    content.stories.story_second = structuredClone(content.stories.story_after_case_001);
    state.pendingStoryIds = ["story_after_case_001", "story_second"];
    expectFailure(
      transition(state, { type: "completeStory", storyId: "missing_story" }, content, {
        nowIso: NOW,
      }),
      "CONTENT_INVALID",
    );
    expectFailure(
      transition(state, { type: "completeStory", storyId: "story_second" }, content, {
        nowIso: NOW,
      }),
      "INVALID_STORY_COMPLETION",
    );
  });

  it("moves only the head story to completed without mutating input", () => {
    const content = catalogCopy();
    content.stories.story_second = structuredClone(content.stories.story_after_case_001);
    const state = initialState();
    state.pendingStoryIds = ["story_after_case_001", "story_second"];
    const before = structuredClone(state);
    deepFreeze(state);

    const nextState = nextStateOf(
      transition(state, { type: "completeStory", storyId: "story_after_case_001" }, content, {
        nowIso: NOW,
      }),
    );

    expect(state).toEqual(before);
    expect(nextState.pendingStoryIds).toEqual(["story_second"]);
    expect(nextState.completedStoryIds).toEqual(["story_after_case_001"]);
    expect(nextState.phase).toEqual({ type: "playing" });
  });

  it("keeps ending phase until the ending story completes, then enters ended", () => {
    const state = initialState();
    state.phase = { type: "ending", endingId: "balanced" };
    state.pendingStoryIds = ["story_after_case_001", "ending_balanced"];

    const afterOrdinaryStory = nextStateOf(
      transition(
        state,
        { type: "completeStory", storyId: "story_after_case_001" },
        MINIMAL_CATALOG,
        { nowIso: NOW },
      ),
    );
    expect(afterOrdinaryStory.phase).toEqual({ type: "ending", endingId: "balanced" });

    const ended = nextStateOf(
      transition(
        afterOrdinaryStory,
        { type: "completeStory", storyId: "ending_balanced" },
        MINIMAL_CATALOG,
        { nowIso: NOW },
      ),
    );
    expect(ended.phase).toEqual({ type: "ended", endingId: "balanced" });
    expect(ended.pendingStoryIds).toEqual([]);
    expect(ended.completedStoryIds).toEqual(["story_after_case_001", "ending_balanced"]);
  });

  it("never re-evaluates unlock, story, or ending rules on completion", () => {
    const state = resolvedStateWithPendingStory();

    const nextState = nextStateOf(
      transition(
        state,
        { type: "completeStory", storyId: "story_after_case_001" },
        MINIMAL_CATALOG,
        { nowIso: NOW },
      ),
    );

    expect(nextState.cases).toEqual(state.cases);
    expect(nextState.cases.case_002).toBeUndefined();
    expect(nextState.pendingStoryIds).toEqual([]);
    expect(nextState.phase).toEqual({ type: "playing" });
  });
});

describe("transition invariant boundary", () => {
  it("rejects an invalid input state as CONTENT_INVALID without modifying it", () => {
    const state = initialState();
    state.attributes.restraint = 101;
    const before = structuredClone(state);

    expectFailure(
      transition(state, { type: "startCase", caseId: "case_001" }, MINIMAL_CATALOG, {
        nowIso: NOW,
      }),
      "CONTENT_INVALID",
    );
    expect(state).toEqual(before);
  });
});
