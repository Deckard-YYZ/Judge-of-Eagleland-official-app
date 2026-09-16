import type { ActionInputStep, GameContentCatalog, GameStoryStep } from "../content/schema";
import { isActionId } from "../shared/action";
import type { GameCommand, TransitionResult, FeedbackRequest } from "./commands";
import { applyGameEffects } from "./effects";
import type { GameState, StoryCheckpoint } from "./model";

/** Invalid persisted positions are compatibility errors, never a reason to replay passed inputs. */
export function getResumeIndex(
  storyId: string,
  steps: readonly GameStoryStep[],
  checkpoint: StoryCheckpoint | null,
): number {
  if (checkpoint === null) return 0;
  const index = steps.findIndex((step) => step.id === checkpoint.resumeStepId);
  if (checkpoint.storyId !== storyId || index < 0) throw new Error("STORY_CHECKPOINT_INVALID");
  return index;
}

export function getNextRequiredInput(
  storyId: string,
  steps: readonly GameStoryStep[],
  checkpoint: StoryCheckpoint | null,
): ActionInputStep | null {
  return (
    steps
      .slice(getResumeIndex(storyId, steps, checkpoint))
      .find((step): step is ActionInputStep => step.type === "actionInput") ?? null
  );
}

/** Internal completion is shared by guarded completeStory and a successful final input. */
export function finishCurrentStory(state: Readonly<GameState>, storyId: string): GameState {
  const pendingStoryIds = state.pendingStoryIds.slice(1);
  return {
    ...state,
    pendingStoryIds,
    completedStoryIds: [...state.completedStoryIds, storyId],
    storyCheckpoint: null,
    phase:
      state.phase.type === "ending" && pendingStoryIds.length === 0
        ? { type: "ended", endingId: state.phase.endingId }
        : state.phase,
  };
}

/** Derives one known input transaction; callers validate input/output state invariants. */
export function submitStoryInput(
  state: Readonly<GameState>,
  command: Extract<GameCommand, { type: "submitStoryInput" }>,
  content: Readonly<GameContentCatalog>,
): TransitionResult {
  if (state.phase.type === "ended")
    return { ok: false, code: "RUN_FINISHED", message: "The run has ended." };
  const story = content.stories[command.storyId];
  if (!story) return { ok: false, code: "CONTENT_INVALID", message: "Input story is missing." };
  if (state.pendingStoryIds[0] !== command.storyId)
    return {
      ok: false,
      code: "STALE_STORY_INPUT",
      message: "Input does not belong to the current story.",
    };
  if (!isActionId(command.actionId))
    return { ok: false, code: "CONTENT_INVALID", message: "Unsupported action ID." };
  const required = getNextRequiredInput(command.storyId, story.steps, state.storyCheckpoint);
  if (!required || command.stepId !== required.id)
    return {
      ok: false,
      code: "STALE_STORY_INPUT",
      message: "Input does not belong to the next required step.",
    };
  if (command.actionId === required.targetActionId) {
    const next = story.steps[story.steps.findIndex((step) => step.id === required.id) + 1];
    return {
      ok: true,
      feedback: [],
      nextState: next
        ? { ...state, storyCheckpoint: { storyId: command.storyId, resumeStepId: next.id } }
        : finishCurrentStory(state, command.storyId),
    };
  }
  const applied = applyGameEffects(
    state,
    required.wrongEffects ?? { attributeDeltas: {}, setFlags: {} },
    content,
    ["stories", command.storyId, "steps", command.stepId, "wrongEffects"],
  );
  if (!applied.ok)
    return { ok: false, code: "CONTENT_INVALID", message: applied.issues[0].message };
  const source = { type: "storyInput" as const, storyId: command.storyId, stepId: command.stepId };
  // A wrong known action remains a committed attempt even when clamping produces no numeric change.
  const feedback: FeedbackRequest[] = [{ type: "inputFeedback", source, outcome: "wrongAction" }];
  if (applied.changes.length > 0)
    feedback.push({ type: "attributeFeedback", source, changes: applied.changes });
  return {
    ok: true,
    feedback,
    nextState: {
      ...state,
      attributes: applied.attributes,
      flags: applied.flags,
      storyCheckpoint: { storyId: command.storyId, resumeStepId: command.stepId },
    },
  };
}
