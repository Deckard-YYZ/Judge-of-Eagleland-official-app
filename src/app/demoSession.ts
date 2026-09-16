import { createGameSession } from "../application/gameSession";
import { ACTION_INPUT_GAME_CONTENT, ACTION_INPUT_LOCALIZATIONS } from "./actionInputContent";
import { FakeSplitContentRepository } from "../content/repository";
import type { GameContentCatalog } from "../content/schema";
import { createInitialGameState } from "../game/initialization";
import type { SaveEnvelope } from "../game/model";
import { InMemorySaveRepository } from "../storage/inMemorySaveRepository";
import { demoTransition } from "./demoTransition";

export const createDemoSave = (
  profileId: string,
  saveId: string,
  content: Readonly<GameContentCatalog>,
  now: string,
): SaveEnvelope => {
  const initialState = createInitialGameState(content);
  if (!initialState.ok) {
    const details = initialState.issues
      .map((issue) => `${issue.code} at ${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Cannot create demo save from invalid content: ${details}`);
  }

  return {
    saveId,
    profileId,
    revision: 0,
    saveSchemaVersion: 3,
    contentRef: {
      packageId: content.manifest.packageId,
      version: content.manifest.version,
    },
    createdAt: now,
    updatedAt: now,
    state: initialState.state,
  };
};

/** 页面生命周期内共享内存仓储；刷新页面会重置这份开发样本。 */
export function createDemoSession() {
  const content = ACTION_INPUT_GAME_CONTENT;
  const now = new Date().toISOString();
  const seed = createDemoSave("demo-profile", "demo-save", content, now);
  const contentRepository = new FakeSplitContentRepository([
    { gameContent: content, localizations: ACTION_INPUT_LOCALIZATIONS },
  ]);

  const session = createGameSession({
    saveRepository: new InMemorySaveRepository([seed]),
    contentRepository,
    transition: demoTransition,
    clock: () => new Date().toISOString(),
  });

  return {
    session,
    contentRepository,
    reload: () => session.load(seed.saveId, seed.profileId),
  };
}
