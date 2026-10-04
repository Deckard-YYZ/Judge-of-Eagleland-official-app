import type { GameContentCatalog } from "../content/schema";
import type { SaveEnvelope } from "../game/model";

const TUTORIAL_STORY_ID = "tutorial_voice_order";

/**
 * Account entry decides first-entry eligibility. New content declares the tutorial
 * separately from ordinary initial stories; legacy fixtures retain their queue.
 */
export function configureInitialTutorial(
  content: Readonly<GameContentCatalog>,
  enabled: boolean,
): Readonly<GameContentCatalog> {
  const tutorialId = content.mainFlow?.tutorialStoryId;
  if (tutorialId) return content;
  if (enabled || !content.initial.storyIds.includes(TUTORIAL_STORY_ID)) {
    return content;
  }

  return Object.freeze({
    ...content,
    initial: Object.freeze({
      ...content.initial,
      storyIds: content.initial.storyIds.filter((storyId) => storyId !== TUTORIAL_STORY_ID),
    }),
  });
}

/** Add first-entry presentation to the candidate save, never to immutable package rules. */
export function withAccountTutorial(
  save: SaveEnvelope,
  content: Readonly<GameContentCatalog>,
  enabled: boolean,
): SaveEnvelope {
  const storyId = content.mainFlow?.tutorialStoryId;
  if (!enabled || !storyId) return save;
  return {
    ...save,
    state: { ...save.state, pendingStoryIds: [storyId, ...save.state.pendingStoryIds] },
  };
}
