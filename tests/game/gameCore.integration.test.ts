import { describe, expect, it } from "vitest";
import { MINIMAL_GAME_CONTENT } from "../../src/content/fixtures/minimalCatalog";
import type { GameCommand, TransitionResult } from "../../src/game/commands";
import { createInitialGameState } from "../../src/game/initialization";
import type { GameState } from "../../src/game/model";
import { transition } from "../../src/game/transition";

const FIRST_TIME = "2026-09-15T09:00:00.000Z";
const SECOND_TIME = "2026-09-15T10:00:00.000Z";

const newGame = (): GameState => {
  const result = createInitialGameState(MINIMAL_GAME_CONTENT);
  if (!result.ok) {
    throw new Error(`Cannot initialize fixture: ${JSON.stringify(result.issues)}`);
  }
  return result.state;
};

const run = (state: Readonly<GameState>, command: GameCommand, nowIso = FIRST_TIME) =>
  transition(state, command, MINIMAL_GAME_CONTENT, { nowIso });

const stateOf = (result: TransitionResult): GameState => {
  if (!result.ok) {
    throw new Error(`Expected success, received ${result.code}: ${result.message}`);
  }
  return result.nextState;
};

interface MatrixPath {
  readonly firstResolution: "close_with_note" | "warning" | "suspension";
  readonly firstFinalChoice: "insufficient_evidence" | "formal_warning" | "suspend_access";
  readonly secondResolution: "review_required" | "temporary_access";
  readonly secondChoice: "request_review" | "grant_access";
  readonly restraint: number;
  readonly authority: number;
  readonly ending: "balanced" | "fallback";
}

const MATRIX_PATHS: readonly MatrixPath[] = [
  {
    firstResolution: "close_with_note",
    firstFinalChoice: "insufficient_evidence",
    secondResolution: "review_required",
    secondChoice: "request_review",
    restraint: 58,
    authority: 48,
    ending: "balanced",
  },
  {
    firstResolution: "warning",
    firstFinalChoice: "formal_warning",
    secondResolution: "review_required",
    secondChoice: "request_review",
    restraint: 56,
    authority: 51,
    ending: "balanced",
  },
  {
    firstResolution: "suspension",
    firstFinalChoice: "suspend_access",
    secondResolution: "review_required",
    secondChoice: "request_review",
    restraint: 53,
    authority: 53,
    ending: "balanced",
  },
  {
    firstResolution: "close_with_note",
    firstFinalChoice: "insufficient_evidence",
    secondResolution: "temporary_access",
    secondChoice: "grant_access",
    restraint: 48,
    authority: 48,
    ending: "fallback",
  },
  {
    firstResolution: "warning",
    firstFinalChoice: "formal_warning",
    secondResolution: "temporary_access",
    secondChoice: "grant_access",
    restraint: 46,
    authority: 51,
    ending: "fallback",
  },
  {
    firstResolution: "suspension",
    firstFinalChoice: "suspend_access",
    secondResolution: "temporary_access",
    secondChoice: "grant_access",
    restraint: 43,
    authority: 53,
    ending: "fallback",
  },
];

const playMatrixPath = (path: MatrixPath): { endingState: GameState; endedState: GameState } => {
  let state = stateOf(run(newGame(), { type: "startCase", caseId: "case_001" }));
  let firstNode = "assessment";
  if (path.firstResolution !== "close_with_note") {
    state = stateOf(
      run(state, {
        type: "chooseOption",
        caseId: "case_001",
        nodeId: "assessment",
        choiceId: "confirm_violation",
      }),
    );
    firstNode = "disposition";
  }
  state = stateOf(
    run(state, {
      type: "chooseOption",
      caseId: "case_001",
      nodeId: firstNode,
      choiceId: path.firstFinalChoice,
    }),
  );
  state = stateOf(run(state, { type: "completeStory", storyId: "story_after_case_001" }));
  state = stateOf(run(state, { type: "startCase", caseId: "case_002" }));
  state = stateOf(
    run(state, {
      type: "chooseOption",
      caseId: "case_002",
      nodeId: "assessment",
      choiceId: path.secondChoice,
    }),
  );

  const endingState = state;
  const endedState = stateOf(
    run(state, { type: "completeStory", storyId: `ending_${path.ending}` }),
  );
  return { endingState, endedState };
};

describe("pure Game Core end-to-end", () => {
  it("runs an intermediate path through ordinary story to the balanced ending and ended phase", () => {
    let state = stateOf(run(newGame(), { type: "startCase", caseId: "case_001" }));
    state = stateOf(
      run(state, {
        type: "chooseOption",
        caseId: "case_001",
        nodeId: "assessment",
        choiceId: "confirm_violation",
      }),
    );
    expect(state.attributes).toEqual({ restraint: 50, authority: 50 });
    expect(state.cases.case_001).toMatchObject({
      status: "active",
      currentNodeId: "disposition",
      history: [{ nodeId: "assessment", choiceId: "confirm_violation" }],
    });

    state = stateOf(
      run(
        state,
        {
          type: "chooseOption",
          caseId: "case_001",
          nodeId: "disposition",
          choiceId: "formal_warning",
        },
        FIRST_TIME,
      ),
    );
    expect(state.attributes).toEqual({ restraint: 51, authority: 51 });
    expect(state.cases.case_001).toMatchObject({
      status: "resolved",
      resolutionId: "warning",
      history: [
        { nodeId: "assessment", choiceId: "confirm_violation" },
        { nodeId: "disposition", choiceId: "formal_warning" },
      ],
      snapshot: {
        resolvedAt: FIRST_TIME,
        resolvedOrder: 1,
        attributeChanges: [
          { attributeId: "authority", before: 50, after: 51, actualDelta: 1 },
          { attributeId: "restraint", before: 50, after: 51, actualDelta: 1 },
        ],
      },
    });
    expect(state.cases.case_002).toEqual({ status: "pending" });
    expect(state.pendingStoryIds).toEqual(["story_after_case_001"]);

    expect(run(state, { type: "startCase", caseId: "case_002" })).toMatchObject({
      ok: false,
      code: "STORY_BLOCKING",
    });
    expect(run(state, { type: "completeStory", storyId: "ending_balanced" })).toMatchObject({
      ok: false,
      code: "INVALID_STORY_COMPLETION",
    });
    state = stateOf(run(state, { type: "completeStory", storyId: "story_after_case_001" }));

    state = stateOf(run(state, { type: "startCase", caseId: "case_002" }));
    state = stateOf(
      run(
        state,
        {
          type: "chooseOption",
          caseId: "case_002",
          nodeId: "assessment",
          choiceId: "request_review",
        },
        SECOND_TIME,
      ),
    );
    expect(state.attributes).toEqual({ restraint: 56, authority: 51 });
    expect(state.cases.case_002).toMatchObject({
      status: "resolved",
      history: [{ nodeId: "assessment", choiceId: "request_review" }],
      resolutionId: "review_required",
      snapshot: {
        resolvedAt: SECOND_TIME,
        resolvedOrder: 2,
        attributeChanges: [{ attributeId: "restraint", before: 51, after: 56, actualDelta: 5 }],
      },
    });
    expect(state.phase).toEqual({ type: "ending", endingId: "balanced" });
    expect(state.pendingStoryIds).toEqual(["ending_balanced"]);

    state = stateOf(run(state, { type: "completeStory", storyId: "ending_balanced" }));
    expect(state.phase).toEqual({ type: "ended", endingId: "balanced" });
    expect(state.completedStoryIds).toEqual(["story_after_case_001", "ending_balanced"]);
    expect(run(state, { type: "startCase", caseId: "case_001" })).toMatchObject({
      ok: false,
      code: "RUN_FINISHED",
    });
  });

  it("takes a different pair of choices to the fallback ending", () => {
    let state = stateOf(run(newGame(), { type: "startCase", caseId: "case_001" }));
    state = stateOf(
      run(state, {
        type: "chooseOption",
        caseId: "case_001",
        nodeId: "assessment",
        choiceId: "insufficient_evidence",
      }),
    );
    expect(state.cases.case_001).toMatchObject({
      status: "resolved",
      history: [{ nodeId: "assessment", choiceId: "insufficient_evidence" }],
      resolutionId: "close_with_note",
    });
    expect(state.attributes).toEqual({ restraint: 53, authority: 48 });

    state = stateOf(run(state, { type: "completeStory", storyId: "story_after_case_001" }));
    state = stateOf(run(state, { type: "startCase", caseId: "case_002" }));
    state = stateOf(
      run(
        state,
        {
          type: "chooseOption",
          caseId: "case_002",
          nodeId: "assessment",
          choiceId: "grant_access",
        },
        SECOND_TIME,
      ),
    );

    expect(state.attributes).toEqual({ restraint: 48, authority: 48 });
    expect(state.cases.case_002).toMatchObject({
      status: "resolved",
      history: [{ nodeId: "assessment", choiceId: "grant_access" }],
      resolutionId: "temporary_access",
      snapshot: {
        resolvedOrder: 2,
        attributeChanges: [{ attributeId: "restraint", before: 53, after: 48, actualDelta: -5 }],
      },
    });
    expect(state.phase).toEqual({ type: "ending", endingId: "fallback" });
    expect(state.pendingStoryIds).toEqual(["ending_fallback"]);

    state = stateOf(run(state, { type: "completeStory", storyId: "ending_fallback" }));
    expect(state.phase).toEqual({ type: "ended", endingId: "fallback" });
  });
});

describe("minimal catalog 3x2 result matrix", () => {
  it.each(MATRIX_PATHS)("$firstResolution + $secondResolution => $ending", (path) => {
    const { endingState, endedState } = playMatrixPath(path);

    expect(endingState.attributes).toEqual({
      restraint: path.restraint,
      authority: path.authority,
    });
    expect(endingState.cases.case_001).toMatchObject({
      status: "resolved",
      resolutionId: path.firstResolution,
    });
    expect(endingState.cases.case_002).toMatchObject({
      status: "resolved",
      resolutionId: path.secondResolution,
    });
    expect(endingState.phase).toEqual({ type: "ending", endingId: path.ending });
    expect(endedState.phase).toEqual({ type: "ended", endingId: path.ending });
  });
});
