import { describe, expect, it } from "vitest";
import type { GameContentCatalog } from "../../src/content/schema";
import { MINIMAL_GAME_CONTENT } from "../../src/content/fixtures/minimalCatalog";
import { createInitialGameState } from "../../src/game/initialization";
import { checkGameStateInvariants, type GameStateInvariantIssue } from "../../src/game/invariants";
import type { GameState } from "../../src/game/model";

const initialState = (content: Readonly<GameContentCatalog> = MINIMAL_GAME_CONTENT): GameState => {
  const result = createInitialGameState(content);
  if (!result.ok) {
    throw new Error("Test catalog should produce an initial state.");
  }
  return result.state;
};

const issuesFor = (
  candidate: unknown,
  content: Readonly<GameContentCatalog> = MINIMAL_GAME_CONTENT,
): readonly GameStateInvariantIssue[] => {
  const result = checkGameStateInvariants(candidate, content);
  if (result.ok) {
    throw new Error("Expected invariant violations.");
  }
  return result.issues;
};

const resolvedCaseState = (): GameState => ({
  phase: { type: "playing" },
  attributes: { restraint: 53, authority: 48 },
  flags: { first_case_closed: true, second_case_reviewed: false },
  cases: {
    case_001: {
      status: "resolved",
      history: [{ nodeId: "assessment", choiceId: "insufficient_evidence" }],
      resolutionId: "close_with_note",
      finalChoiceId: "insufficient_evidence",
      snapshot: {
        attributeChanges: [
          {
            attributeId: "restraint",
            before: 50,
            after: 53,
            actualDelta: 3,
          },
          {
            attributeId: "authority",
            before: 50,
            after: 48,
            actualDelta: -2,
          },
        ],
        resolvedAt: "2026-09-15T00:00:00.000Z",
        resolvedOrder: 1,
      },
    },
  },
  pendingStoryIds: [],
  completedStoryIds: [],
  storyCheckpoint: null,
});

describe("checkGameStateInvariants", () => {
  it("accepts a valid active node and verifies its recorded path", () => {
    const state = initialState();
    state.cases.case_001 = {
      status: "active",
      currentNodeId: "disposition",
      history: [{ nodeId: "assessment", choiceId: "confirm_violation" }],
    };

    expect(checkGameStateInvariants(state, MINIMAL_GAME_CONTENT)).toEqual({ ok: true });

    state.cases.case_001 = {
      status: "active",
      currentNodeId: "missing_node",
      history: [{ nodeId: "assessment", choiceId: "confirm_violation" }],
    };
    expect(issuesFor(state).map((issue) => issue.code)).toContain("CASE_REFERENCE_INVALID");
  });

  it("rejects unknown choices and discontinuous active history", () => {
    const state = initialState();
    state.cases.case_001 = {
      status: "active",
      currentNodeId: "assessment",
      history: [{ nodeId: "disposition", choiceId: "missing_choice" }],
    };

    const issues = issuesFor(state);
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["CASE_PATH_INVALID", "CASE_REFERENCE_INVALID"]),
    );
  });

  it("accepts a resolved path and validates resolution and snapshot references", () => {
    const state = resolvedCaseState();
    const before = structuredClone(state);

    expect(checkGameStateInvariants(state, MINIMAL_GAME_CONTENT)).toEqual({ ok: true });
    expect(state).toEqual(before);

    const progress = state.cases.case_001;
    if (progress.status !== "resolved") {
      throw new Error("Expected resolved fixture.");
    }
    progress.resolutionId = "missing_resolution";

    expect(issuesFor(state).map((issue) => issue.code)).toContain("RESOLUTION_REFERENCE_INVALID");
  });

  it("rejects resolved history or snapshot data inconsistent with the selected resolution", () => {
    const state = resolvedCaseState();
    const progress = state.cases.case_001;
    if (progress.status !== "resolved") {
      throw new Error("Expected resolved fixture.");
    }
    progress.history[0].choiceId = "confirm_violation";
    progress.snapshot.attributeChanges[0].attributeId = "unknown_attribute";
    progress.snapshot.attributeChanges[1].actualDelta = -1;

    const issueCodes = issuesFor(state).map((issue) => issue.code);
    expect(issueCodes).toContain("CASE_PATH_INVALID");
    expect(issueCodes).toContain("RESOLUTION_SNAPSHOT_INVALID");
  });

  it("requires the exact attribute and flag sets and enforces attribute ranges", () => {
    const state = initialState();
    delete state.attributes.authority;
    state.attributes.unknown_attribute = 10;
    state.attributes.restraint = 101;
    delete state.flags.second_case_reviewed;
    state.flags.unknown_flag = true;

    const issueCodes = issuesFor(state).map((issue) => issue.code);
    expect(issueCodes).toEqual(
      expect.arrayContaining([
        "ATTRIBUTE_SET_INVALID",
        "ATTRIBUTE_OUT_OF_RANGE",
        "FLAG_SET_INVALID",
      ]),
    );
  });

  it("rejects unknown cases and non-contiguous resolved order values", () => {
    const state = resolvedCaseState();
    const progress = state.cases.case_001;
    if (progress.status !== "resolved") {
      throw new Error("Expected resolved fixture.");
    }
    progress.snapshot.resolvedOrder = 2;
    state.cases.unknown_case = { status: "pending" };

    const issueCodes = issuesFor(state).map((issue) => issue.code);
    expect(issueCodes).toEqual(
      expect.arrayContaining(["CASE_REFERENCE_INVALID", "RESOLVED_ORDER_INVALID"]),
    );
  });

  it("reuses the state schema for story uniqueness and checks story references", () => {
    const duplicated = initialState();
    duplicated.pendingStoryIds = ["story_after_case_001", "story_after_case_001"];
    expect(issuesFor(duplicated).map((issue) => issue.code)).toContain("STORY_QUEUE_INVALID");

    const overlapped = initialState();
    overlapped.pendingStoryIds = ["story_after_case_001"];
    overlapped.completedStoryIds = ["story_after_case_001"];
    expect(issuesFor(overlapped).map((issue) => issue.code)).toContain("STORY_QUEUE_INVALID");

    const unknown = initialState();
    unknown.pendingStoryIds = ["missing_story"];
    expect(issuesFor(unknown).map((issue) => issue.code)).toContain("STORY_REFERENCE_INVALID");
  });

  it("rejects any ending story while the run is still playing", () => {
    const state = initialState();
    state.pendingStoryIds = ["ending_balanced"];
    state.completedStoryIds = ["ending_fallback"];

    expect(issuesFor(state).filter((issue) => issue.code === "PHASE_STORY_INVALID")).toHaveLength(
      2,
    );
  });

  it("ties ending phases to an existing ending and its final queued story", () => {
    const ending = initialState();
    ending.phase = { type: "ending", endingId: "balanced" };
    ending.pendingStoryIds = ["story_after_case_001", "ending_balanced"];
    expect(checkGameStateInvariants(ending, MINIMAL_GAME_CONTENT)).toEqual({ ok: true });

    ending.pendingStoryIds.reverse();
    expect(issuesFor(ending).map((issue) => issue.code)).toContain("PHASE_STORY_INVALID");

    ending.pendingStoryIds = ["story_after_case_001", "ending_balanced"];
    ending.completedStoryIds = ["ending_fallback"];
    expect(issuesFor(ending).map((issue) => issue.code)).toContain("PHASE_STORY_INVALID");

    ending.phase = { type: "ending", endingId: "missing_ending" };
    expect(issuesFor(ending).map((issue) => issue.code)).toContain("ENDING_REFERENCE_INVALID");
  });

  it("requires ended runs to have no pending story and a completed ending story", () => {
    const ended = initialState();
    ended.phase = { type: "ended", endingId: "fallback" };
    ended.completedStoryIds = ["ending_fallback"];
    expect(checkGameStateInvariants(ended, MINIMAL_GAME_CONTENT)).toEqual({ ok: true });

    ended.completedStoryIds = ["ending_balanced", "ending_fallback"];
    expect(issuesFor(ended).map((issue) => issue.code)).toContain("PHASE_STORY_INVALID");

    ended.completedStoryIds = [];
    ended.pendingStoryIds = ["story_after_case_001"];
    const issues = issuesFor(ended);
    expect(issues.filter((issue) => issue.code === "PHASE_STORY_INVALID")).toHaveLength(2);
  });
});
