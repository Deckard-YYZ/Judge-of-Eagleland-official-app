import { describe, expect, it } from "vitest";
import { MINIMAL_GAME_CONTENT } from "../../src/content/fixtures/minimalCatalog";
import { createInitialGameState } from "../../src/game/initialization";
import { checkGameStateInvariants } from "../../src/game/invariants";
import { GameCommandSchema } from "../../src/game/commands";
import { transition } from "../../src/game/transition";
import type { GameState } from "../../src/game/model";

const makeContent = () => {
  const content = structuredClone(MINIMAL_GAME_CONTENT);
  content.manifest.contentSchemaVersion = 3;
  content.initial.storyIds = ["input"];
  content.stories.input = {
    skippable: false,
    steps: [
      { id: "a", type: "text" },
      {
        id: "b",
        type: "actionInput",
        targetActionId: "salute",
        wrongEffects: {
          attributeDeltas: { authority: -70 },
          setFlags: { first_case_closed: true },
        },
      },
      { id: "c", type: "text" },
    ],
  };
  return content;
};
const initial = (content: ReturnType<typeof makeContent>) => {
  const result = createInitialGameState(content);
  if (!result.ok) throw new Error("invalid fixture");
  return result.state;
};
const context = { nowIso: "2026-09-16T00:00:00.000Z" };
const input = {
  type: "submitStoryInput" as const,
  storyId: "input",
  stepId: "b",
  actionId: "salute" as const,
};

describe("story input facts", () => {
  it("protects input completion, clamps penalties, preserves history and advances only committed position", () => {
    const content = makeContent();
    const state = initial(content);
    expect(
      transition(state, { type: "completeStory", storyId: "input" }, content, context),
    ).toMatchObject({ ok: false, code: "STORY_INPUT_REQUIRED" });
    const wrong = transition(state, { ...input, actionId: "wave" }, content, context);
    if (!wrong.ok) throw new Error("wrong action must be accepted");
    expect(wrong.nextState.storyCheckpoint).toEqual({ storyId: "input", resumeStepId: "b" });
    expect(wrong.nextState.attributes.authority).toBe(0);
    expect(wrong.nextState.flags.first_case_closed).toBe(true);
    expect(wrong.nextState.cases).toEqual(state.cases);
    expect(wrong.feedback).toContainEqual({
      type: "attributeFeedback",
      source: { type: "storyInput", storyId: "input", stepId: "b" },
      changes: [{ attributeId: "authority", before: 50, after: 0, actualDelta: -50 }],
    });
    expect(state.attributes.authority).toBe(50);
    const correct = transition(wrong.nextState, input, content, context);
    if (!correct.ok) throw new Error("expected success");
    expect(correct.nextState.storyCheckpoint).toEqual({ storyId: "input", resumeStepId: "c" });
    expect(transition(correct.nextState, input, content, context)).toMatchObject({
      ok: false,
      code: "STALE_STORY_INPUT",
    });
    expect(
      transition(correct.nextState, { type: "completeStory", storyId: "input" }, content, context),
    ).toMatchObject({
      ok: true,
      nextState: { storyCheckpoint: null, completedStoryIds: ["input"] },
    });
  });

  it("commits no-effect wrong actions and finishes a final input atomically", () => {
    const content = makeContent();
    content.stories.input.steps = [{ id: "b", type: "actionInput", targetActionId: "salute" }];
    const state = initial(content);
    expect(transition(state, { ...input, actionId: "wave" }, content, context)).toMatchObject({
      ok: true,
      feedback: [{ type: "inputFeedback", outcome: "wrongAction" }],
      nextState: { storyCheckpoint: { storyId: "input", resumeStepId: "b" } },
    });
    expect(transition(state, input, content, context)).toMatchObject({
      ok: true,
      nextState: { pendingStoryIds: [], completedStoryIds: ["input"], storyCheckpoint: null },
    });
    expect(GameCommandSchema.safeParse({ ...input, actionId: "unknown" }).success).toBe(false);
  });

  it("accepts inputs during ending and ends atomically without reselecting the ending", () => {
    const content = makeContent();
    const endingId = Object.keys(content.endings)[0];
    const storyId = content.endings[endingId].storyId;
    content.stories[storyId] = {
      skippable: false,
      steps: [{ id: "last", type: "actionInput", targetActionId: "salute" }],
    };
    const state: GameState = {
      ...initial(content),
      phase: { type: "ending", endingId },
      pendingStoryIds: [storyId],
    };
    const command = { ...input, storyId, stepId: "last" };
    const result = transition(state, command, content, context);
    if (!result.ok) throw new Error("expected ending completion");
    expect(result.nextState).toMatchObject({
      phase: { type: "ended", endingId },
      pendingStoryIds: [],
      storyCheckpoint: null,
    });
    expect(transition(result.nextState, command, content, context)).toMatchObject({
      ok: false,
      code: "RUN_FINISHED",
    });
    expect(
      transition(
        state,
        { ...command, actionId: "unsupported" } as unknown as typeof command,
        content,
        context,
      ),
    ).toMatchObject({ ok: false, code: "CONTENT_INVALID" });
  });

  it("rejects broken checkpoint ownership and missing steps without resetting", () => {
    const content = makeContent();
    for (const checkpoint of [
      { storyId: "other", resumeStepId: "b" },
      { storyId: "input", resumeStepId: "deleted" },
    ]) {
      const state: GameState = { ...initial(content), storyCheckpoint: checkpoint };
      expect(checkGameStateInvariants(state, content)).toMatchObject({
        ok: false,
        issues: [{ code: "STORY_CHECKPOINT_INVALID" }],
      });
      expect(transition(state, input, content, context)).toMatchObject({
        ok: false,
        code: "CONTENT_INVALID",
      });
    }
  });
});
