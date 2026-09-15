import { createGameSession } from "../application/gameSession";
import { MINIMAL_CATALOG } from "../content/fixtures/minimalCatalog";
import { FakeContentRepository } from "../content/repository";
import type { Transition } from "../game/commands";
import type { SaveEnvelope } from "../game/model";
import { InMemorySaveRepository } from "../storage/inMemorySaveRepository";

/**
 * 开发页只验证一次 pending → active 的会话提交。
 * 这不是正式规则实现；规则线接入时直接替换注入的 Transition。
 */
const demoTransition: Transition = (state, command, content) => {
  if (command.type !== "startCase") {
    return {
      ok: false,
      code: "INVALID_CHOICE",
      message: "开发探针只支持开始案件。",
    };
  }

  const progress = state.cases[command.caseId];
  const definition = content.cases[command.caseId];

  if (!progress || !definition) {
    return { ok: false, code: "CASE_LOCKED", message: "案件尚未解锁。" };
  }

  if (progress.status !== "pending") {
    return {
      ok: false,
      code: "CASE_ALREADY_STARTED",
      message: "该探针案件已经开始。",
    };
  }

  return {
    ok: true,
    nextState: {
      ...state,
      cases: {
        ...state.cases,
        [command.caseId]: {
          status: "active",
          currentNodeId: definition.startNodeId,
          history: [],
        },
      },
    },
    feedback: [],
  };
};

/** 页面生命周期内共享内存仓储；刷新页面会重置这份开发样本。 */
export function createDemoSession() {
  const content = MINIMAL_CATALOG;
  const now = new Date().toISOString();
  const seed: SaveEnvelope = {
    saveId: "demo-save",
    profileId: "demo-profile",
    revision: 0,
    saveSchemaVersion: 1,
    contentRef: {
      packageId: content.manifest.packageId,
      version: content.manifest.version,
    },
    createdAt: now,
    updatedAt: now,
    state: {
      phase: { type: "playing" },
      attributes: Object.fromEntries(
        Object.entries(content.attributes).map(([id, attribute]) => [id, attribute.initial]),
      ),
      flags: { ...content.initial.flags },
      cases: Object.fromEntries(
        content.initial.caseIds.map((caseId) => [caseId, { status: "pending" as const }]),
      ),
      pendingStoryIds: [...content.initial.storyIds],
      completedStoryIds: [],
    },
  };

  const session = createGameSession({
    saveRepository: new InMemorySaveRepository([seed]),
    contentRepository: new FakeContentRepository([content]),
    transition: demoTransition,
    clock: () => new Date().toISOString(),
  });

  return {
    session,
    reload: () => session.load(seed.saveId, seed.profileId),
  };
}
