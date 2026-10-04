import {
  CONFIGURATION_PILOT_GAME_CONTENT,
  CONFIGURATION_PILOT_LOCALIZATIONS,
} from "../../src/app/configurationPilot";
import type {
  GameContentCatalog,
  LocalizedContentCatalog,
  ContentLocale,
} from "../../src/content/schema";
import { createDemoSave } from "../../src/app/demoSession";
import { createGameSession } from "../../src/application/gameSession";
import { FakeSplitContentRepository } from "../../src/content/repository";
import { transition } from "../../src/game/transition";
import { InMemorySaveRepository } from "../../src/storage/inMemorySaveRepository";
import type { SaveRepository } from "../../src/storage/saveRepository";

export const MAIN_FLOW_NOW = "2026-10-04T00:00:00.000Z";
export function mainFlowFixture() {
  const game: GameContentCatalog = structuredClone(CONFIGURATION_PILOT_GAME_CONTENT);
  game.manifest = { ...game.manifest, packageId: "mainflow-test", contentSchemaVersion: 6 };
  game.initial.caseIds = [];
  game.initial.storyIds = [];
  game.configuration!.actionInputHooks = [];
  game.configuration!.dispatchRules = [];
  game.configuration!.casePools = {};
  game.cases.intake.characters = [{ id: "clerk" }];
  game.cases.intake.nodes.assessment.choices.forEach((choice) => {
    choice.target = { type: "node", nodeId: "review" };
  });
  game.cases.intake.nodes.review = {
    choices: [
      { id: "continue", hasAnnotation: false, target: { type: "node", nodeId: "disposition" } },
    ],
  };
  game.stories.tutorial = structuredClone(game.stories.judgment_notice);
  for (const story of Object.values(game.stories))
    for (const step of story.steps) if (step.type === "actionInput") delete step.wrongEffects;
  game.mainFlow = {
    initialNodeId: "start",
    tutorialStoryId: "tutorial",
    nodes: {
      start: {
        stageId: "first",
        onEnter: [
          { type: "dispatchCase", caseId: "intake" },
          { type: "startChat", chatId: "clerk", instanceId: "a" },
          { type: "startChat", chatId: "clerk", instanceId: "b" },
          { type: "publishNews", newsId: "notice" },
        ],
        transitions: [
          {
            id: "normal",
            when: { all: [{ type: "chatResult", instanceId: "a", resultId: "accepted" }] },
            targetNodeId: "done",
          },
          {
            id: "ignored",
            when: { all: [{ type: "chatResult", instanceId: "a", resultId: "ignored" }] },
            targetNodeId: "done",
          },
        ],
      },
      done: {
        stageId: "second",
        onEnter: [
          { type: "openPool", poolId: "next" },
          {
            type: "dispatchPool",
            poolId: "next",
            strategy: { type: "ordered", caseIds: ["followup"] },
          },
          { type: "startChat", chatId: "clerk", instanceId: "c" },
        ],
        transitions: [],
      },
    },
    chats: {
      clerk: {
        characterId: "clerk",
        startNodeId: "hello",
        nodes: {
          hello: { type: "message", replies: [{ id: "reply", targetNodeId: "question" }] },
          question: { type: "message", replies: [{ id: "yes", targetNodeId: "end" }] },
          end: { type: "terminal", resultId: "accepted" },
        },
        inactivity: { choiceThreshold: 2, resultId: "ignored" },
      },
    },
    casePools: {
      next: {
        members: [
          { caseId: "followup", when: { all: [{ type: "resolvedCountAtLeast", count: 0 }] } },
        ],
      },
    },
    news: { notice: { actionStoryId: "judgment_notice" } },
  };
  const localizations: Record<ContentLocale, LocalizedContentCatalog> = structuredClone(
    CONFIGURATION_PILOT_LOCALIZATIONS,
  );
  for (const copy of Object.values(localizations)) {
    copy.packageId = game.manifest.packageId;
    copy.cases.intake.characters.clerk = { name: "Clerk", description: [] };
    copy.cases.intake.nodes.review = { prompt: "Review the record" };
    copy.cases.intake.choices.continue = { text: "Continue" };
    copy.stories.tutorial = structuredClone(copy.stories.judgment_notice);
    copy.mainFlow = {
      chats: {
        clerk: {
          title: "Clerk chat",
          nodes: {
            hello: {
              blocks: [{ type: "paragraph", text: "Hello" }],
              replies: { reply: "Please continue" },
            },
            question: {
              blocks: [{ type: "paragraph", text: "Do you agree?" }],
              replies: { yes: "Yes" },
            },
            end: { blocks: [{ type: "paragraph", text: "Goodbye" }], replies: {} },
          },
        },
      },
      news: { notice: { title: "News", blocks: [{ type: "paragraph", text: "Read the news" }] } },
    };
  }
  return { game, localizations };
}
export const mainFlowSave = (game = mainFlowFixture().game) =>
  createDemoSave("main-profile", "main-save", game, MAIN_FLOW_NOW);
export async function mainFlowSession(saves?: SaveRepository, fixture = mainFlowFixture()) {
  const repository = saves ?? new InMemorySaveRepository([mainFlowSave(fixture.game)]);
  const content = new FakeSplitContentRepository([
    { gameContent: fixture.game, localizations: fixture.localizations },
  ]);
  const session = createGameSession({
    saveRepository: repository,
    contentRepository: content,
    transition,
    clock: () => MAIN_FLOW_NOW,
  });
  const loaded = await session.load("main-save", "main-profile");
  if (!loaded.ok) throw new Error(loaded.message);
  return { session, content, saves: repository, ...fixture };
}
export const mainFlowChoices = [
  { type: "chooseOption", caseId: "intake", nodeId: "assessment", choiceId: "review" },
  { type: "chooseOption", caseId: "intake", nodeId: "review", choiceId: "continue" },
  { type: "chooseOption", caseId: "intake", nodeId: "disposition", choiceId: "approve" },
] as const;
