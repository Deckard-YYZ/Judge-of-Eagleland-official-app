import { describe, expect, it } from "vitest";
import { createDemoSave } from "../../src/app/demoSession";
import { demoTransition } from "../../src/app/demoTransition";
import { MINIMAL_CATALOG } from "../../src/content/fixtures/minimalCatalog";
import type { GameCommand, TransitionResult } from "../../src/game/commands";
import type { GameState } from "../../src/game/model";
import { transition } from "../../src/game/transition";

const NOW = "2026-09-15T00:00:00.000Z";

const initialState = (): GameState => createDemoSave("profile", "save", MINIMAL_CATALOG, NOW).state;

const run = (state: GameState, command: GameCommand): TransitionResult =>
  demoTransition(state, command, MINIMAL_CATALOG, { nowIso: NOW });

const success = (result: TransitionResult): GameState => {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.nextState;
};

describe("demoTransition", () => {
  it("is the formal Game Core transition under the compatibility name", () => {
    expect(demoTransition).toBe(transition);
  });

  it("completes the two-case, normal-story and ending-story loop", () => {
    let state = success(run(initialState(), { type: "startCase", caseId: "case_001" }));
    expect(state.cases.case_001).toMatchObject({
      status: "active",
      currentNodeId: "assessment",
    });

    expect(run(state, { type: "startCase", caseId: "case_001" })).toMatchObject({
      ok: false,
      code: "CASE_ALREADY_STARTED",
    });
    state = success(
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

    expect(
      run(state, {
        type: "chooseOption",
        caseId: "case_001",
        nodeId: "assessment",
        choiceId: "confirm_violation",
      }),
    ).toMatchObject({ ok: false, code: "STALE_CHOICE" });
    state = success(
      run(state, {
        type: "chooseOption",
        caseId: "case_001",
        nodeId: "disposition",
        choiceId: "formal_warning",
      }),
    );

    expect(state.attributes).toEqual({ restraint: 51, authority: 51 });
    expect(state.cases.case_001).toMatchObject({
      status: "resolved",
      resolutionId: "warning",
      snapshot: {
        finalChoiceText: "给予书面警告",
        resolvedAt: NOW,
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

    state = success(run(state, { type: "completeStory", storyId: "story_after_case_001" }));
    expect(
      run(state, {
        type: "chooseOption",
        caseId: "case_001",
        nodeId: "disposition",
        choiceId: "formal_warning",
      }),
    ).toMatchObject({ ok: false, code: "CASE_ALREADY_RESOLVED" });

    state = success(run(state, { type: "startCase", caseId: "case_002" }));
    state = success(
      run(state, {
        type: "chooseOption",
        caseId: "case_002",
        nodeId: "assessment",
        choiceId: "request_review",
      }),
    );
    expect(state.phase).toEqual({ type: "ending", endingId: "balanced" });
    expect(state.pendingStoryIds).toEqual(["ending_balanced"]);
    expect(state.cases.case_002).toMatchObject({
      status: "resolved",
      snapshot: { resolvedOrder: 2 },
    });
    expect(run(state, { type: "startCase", caseId: "case_001" })).toMatchObject({
      ok: false,
      code: "RUN_FINISHED",
    });

    state = success(run(state, { type: "completeStory", storyId: "ending_balanced" }));
    expect(state.phase).toEqual({ type: "ended", endingId: "balanced" });
    expect(state.completedStoryIds).toEqual(["story_after_case_001", "ending_balanced"]);
    expect(run(state, { type: "completeStory", storyId: "ending_balanced" })).toMatchObject({
      ok: false,
      code: "RUN_FINISHED",
    });
  });

  it("clamps attributes and snapshots the actual delta", () => {
    const base = initialState();
    base.attributes.restraint = 99;
    let state = success(run(base, { type: "startCase", caseId: "case_001" }));
    const result = run(state, {
      type: "chooseOption",
      caseId: "case_001",
      nodeId: "assessment",
      choiceId: "insufficient_evidence",
    });
    state = success(result);

    expect(state.attributes.restraint).toBe(100);
    expect(state.cases.case_001).toMatchObject({
      status: "resolved",
      snapshot: {
        attributeChanges: [
          { attributeId: "authority", before: 50, after: 48, actualDelta: -2 },
          { attributeId: "restraint", before: 99, after: 100, actualDelta: 1 },
        ],
      },
    });
    expect(
      result.ok && result.feedback[0]?.changes.find((change) => change.attributeId === "restraint"),
    ).toMatchObject({
      attributeId: "restraint",
      actualDelta: 1,
    });
  });

  it("rejects locked cases, invalid choices and non-head story completion", () => {
    const state = initialState();
    expect(run(state, { type: "startCase", caseId: "case_002" })).toMatchObject({
      ok: false,
      code: "CASE_LOCKED",
    });

    const active = success(run(state, { type: "startCase", caseId: "case_001" }));
    expect(
      run(active, {
        type: "chooseOption",
        caseId: "case_001",
        nodeId: "assessment",
        choiceId: "does_not_exist",
      }),
    ).toMatchObject({ ok: false, code: "INVALID_CHOICE" });
    expect(run(active, { type: "completeStory", storyId: "ending_fallback" })).toMatchObject({
      ok: false,
      code: "INVALID_STORY_COMPLETION",
    });
  });

  it("reports invalid initial content at the demo composition boundary", () => {
    const content = structuredClone(MINIMAL_CATALOG);
    content.initial.caseIds = ["case_001", "case_001"];

    expect(() => createDemoSave("profile", "save", content, NOW)).toThrow(/INITIAL_CASE_DUPLICATE/);
  });
});
