import type { GameContentCatalog } from "../content/schema";

const TUTORIAL_STORY_ID = "tutorial_voice_order";

/**
 * Temporary composition switch: keep the tutorial content installed and tested,
 * but omit its automatic queue entry for newly created player saves.
 */
export function configureInitialTutorial(
  content: Readonly<GameContentCatalog>,
  enabled: boolean,
): Readonly<GameContentCatalog> {
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
