import {
  CONFIGURATION_PILOT_GAME_CONTENT,
  CONFIGURATION_PILOT_LOCALIZATIONS,
} from "../../src/app/configurationPilot";
import { createDemoSave } from "../../src/app/demoSession";
import { createGameSession, type GameSession } from "../../src/application/gameSession";
import { FakeSplitContentRepository } from "../../src/content/repository";
import type {
  ContentLocale,
  GameContentCatalog,
  LocalizedContentCatalog,
} from "../../src/content/schema";
import { transition } from "../../src/game/transition";
import type { SaveRepository } from "../../src/storage/saveRepository";
import { InMemorySaveRepository } from "../../src/storage/inMemorySaveRepository";

export const PILOT_NOW = "2026-10-04T00:00:00.000Z";
export const pilotSave = (game = CONFIGURATION_PILOT_GAME_CONTENT) =>
  createDemoSave("pilot-profile", "pilot-save", game, PILOT_NOW);
export const pilotRepository = (
  game: Readonly<GameContentCatalog> = CONFIGURATION_PILOT_GAME_CONTENT,
  localizations: Readonly<
    Record<ContentLocale, LocalizedContentCatalog>
  > = CONFIGURATION_PILOT_LOCALIZATIONS,
) => new FakeSplitContentRepository([{ gameContent: game, localizations }]);
export async function pilotSession(
  saves: SaveRepository = new InMemorySaveRepository([pilotSave()]),
  game: Readonly<GameContentCatalog> = CONFIGURATION_PILOT_GAME_CONTENT,
  localizations: Readonly<
    Record<ContentLocale, LocalizedContentCatalog>
  > = CONFIGURATION_PILOT_LOCALIZATIONS,
) {
  const content = pilotRepository(game, localizations);
  const session = createGameSession({
    saveRepository: saves,
    contentRepository: content,
    transition,
    clock: () => PILOT_NOW,
  });
  const loaded = await session.load("pilot-save", "pilot-profile");
  if (!loaded.ok) throw new Error(loaded.message);
  return { session, content, saves };
}
export async function preparePilotVerdict(session: GameSession) {
  await session.dispatch({ type: "startCase", caseId: "intake" });
  await session.dispatch({
    type: "chooseOption",
    caseId: "intake",
    nodeId: "assessment",
    choiceId: "review",
  });
}
export const pilotVerdict = {
  type: "chooseOption",
  caseId: "intake",
  nodeId: "disposition",
  choiceId: "approve",
} as const;
export const pilotInput = (actionId: "salute" | "wave") =>
  ({
    type: "submitStoryInput",
    storyId: "judgment_notice",
    stepId: "required_action",
    actionId,
  }) as const;
