import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createGameContentView, projectNarration } from "../../src/application/gameContentView";
import {
  MINIMAL_GAME_CONTENT,
  MINIMAL_EN_US,
  MINIMAL_ZH_CN,
} from "../../src/content/fixtures/minimalCatalog";
import { GameStoryStepSchema } from "../../src/content/schema";
import {
  validateGameContentCatalog,
  validateLocalizedContentCatalog,
} from "../../src/content/validate";
import { loadSplitContentPackage } from "../../src/content/localizedPackageFormat";
import { createInitialGameState } from "../../src/game/initialization";
import { transition } from "../../src/game/transition";

function fixture() {
  const game = structuredClone(MINIMAL_GAME_CONTENT);
  game.manifest.contentSchemaVersion = 4;
  game.initial.storyIds = ["narrated"];
  game.stories.narrated = {
    skippable: false,
    steps: [
      { id: "intro", type: "text", narration: { voiceId: "system", textSource: "blocks" } },
      {
        id: "order",
        type: "actionInput",
        targetActionId: "salute",
        narration: { voiceId: "system", textSource: "narrationText" },
        wrongEffects: { attributeDeltas: { authority: -2 }, setFlags: {} },
      },
      { id: "end", type: "text" },
    ],
  };
  const localized = structuredClone(MINIMAL_EN_US);
  localized.stories.narrated = {
    title: "Narration",
    steps: {
      intro: {
        blocks: [
          { type: "heading", text: " First " },
          { type: "quote", text: "Second" },
          { type: "paragraph", text: "Third" },
        ],
      },
      order: {
        blocks: [{ type: "paragraph", text: "Instructions differ from speech." }],
        narrationText: " Please salute. ",
      },
      end: { blocks: [{ type: "paragraph", text: "Finished" }] },
    },
  };
  return { game, localized };
}

describe("content v4 narration", () => {
  it("preserves the exact game facts for wrong, correct, and completion commands", () => {
    const { game } = fixture();
    const silent = structuredClone(game);
    for (const step of silent.stories.narrated.steps) {
      if (step.type === "text" || step.type === "actionInput") delete step.narration;
    }
    const initial = createInitialGameState(game);
    const silentInitial = createInitialGameState(silent);
    expect(initial).toEqual(silentInitial);
    if (!initial.ok || !silentInitial.ok) throw new Error("Invalid fixture");
    let state = initial.state;
    let silentState = silentInitial.state;
    const commands = [
      { type: "submitStoryInput", storyId: "narrated", stepId: "order", actionId: "wave" },
      { type: "submitStoryInput", storyId: "narrated", stepId: "order", actionId: "salute" },
      { type: "completeStory", storyId: "narrated" },
    ] as const;
    for (const command of commands) {
      const context = { nowIso: "2026-09-18T00:00:00.000Z" };
      const result = transition(state, command, game, context);
      const silentResult = transition(silentState, command, silent, context);
      expect(result).toEqual(silentResult);
      if (!result.ok || !silentResult.ok) throw new Error("Expected accepted command");
      state = result.nextState;
      silentState = silentResult.nextState;
    }
    expect(state.completedStoryIds).toContain("narrated");
  });
  it("projects ordered pure text and dedicated copy without leaking configuration or effects", () => {
    const { game, localized } = fixture();
    const before = structuredClone({ game, localized });
    expect(validateGameContentCatalog(game).ok).toBe(true);
    expect(validateLocalizedContentCatalog(localized, game).ok).toBe(true);
    const steps = createGameContentView(game, localized).stories.narrated.steps;
    expect(steps[0]).toHaveProperty("narration", {
      voiceId: "system",
      locale: "en-US",
      text: "First\nSecond\nThird",
    });
    expect(steps[1]).toEqual({
      id: "order",
      type: "actionInput",
      targetActionId: "salute",
      blocks: localized.stories.narrated.steps.order.blocks,
      narration: { voiceId: "system", locale: "en-US", text: "Please salute." },
    });
    expect(steps[2]).not.toHaveProperty("narration");
    expect({ game, localized }).toEqual(before);
    expect(Object.isFrozen(steps[1].type === "actionInput" && steps[1].narration)).toBe(true);
  });

  it.each([2, 3] as const)("rejects both new fields in schema v%s", (version) => {
    const { game, localized } = fixture();
    game.manifest.contentSchemaVersion = version;
    expect(validateGameContentCatalog(game).ok).toBe(false);
    expect(validateLocalizedContentCatalog(localized, game).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "NARRATION_VERSION_UNSUPPORTED" })]),
    );
  });

  it.each([undefined, "", " \n\t "])("rejects missing/blank dedicated narration: %s", (text) => {
    const { game, localized } = fixture();
    localized.stories.narrated.steps.order.narrationText = text;
    expect(validateLocalizedContentCatalog(localized, game).issues).toContainEqual(
      expect.objectContaining({ code: "NARRATION_TEXT_MISSING" }),
    );
  });

  it("rejects whitespace blocks and unused dedicated text, including video fallback text", () => {
    const { game, localized } = fixture();
    localized.stories.narrated.steps.intro.blocks = [{ type: "paragraph", text: "  " }];
    localized.stories.narrated.steps.end.narrationText = "Unused";
    localized.stories.ending_balanced.steps.closing_video.narrationText = "Unused video";
    const issues = validateLocalizedContentCatalog(localized, game).issues;
    expect(issues.filter(({ code }) => code === "NARRATION_TEXT_UNUSED")).toHaveLength(2);
    expect(issues).toContainEqual(expect.objectContaining({ code: "NARRATION_TEXT_MISSING" }));
  });

  it.each([
    {
      id: "a",
      type: "video",
      assetId: "video",
      narration: { voiceId: "system", textSource: "blocks" },
    },
    {
      id: "a",
      type: "effect",
      effect: "fade",
      durationMs: 1,
      narration: { voiceId: "system", textSource: "blocks" },
    },
    { id: "a", type: "text", narration: { voiceId: "unknown", textSource: "blocks" } },
    { id: "a", type: "text", narration: { voiceId: "system", textSource: "DOM" } },
    { id: "a", type: "text", narration: { voiceId: "system", textSource: "blocks", speaker: 1 } },
  ])("rejects unsupported placement or provider configuration: %j", (step) => {
    expect(GameStoryStepSchema.safeParse(step).success).toBe(false);
  });

  it("uses the actual loaded locale and guards pure projection against unusable text", () => {
    const { game, localized } = fixture();
    localized.locale = MINIMAL_ZH_CN.locale;
    localized.stories.narrated.steps.order.narrationText = "请敬礼。";
    expect(createGameContentView(game, localized).stories.narrated.steps[1]).toHaveProperty(
      "narration",
      { voiceId: "system", locale: "zh-CN", text: "请敬礼。" },
    );
    expect(projectNarration(undefined, { blocks: [] }, "en-US")).toBeUndefined();
    expect(() =>
      projectNarration(undefined, { blocks: [], narrationText: "unused" }, "en-US"),
    ).toThrow("NARRATION_TEXT_UNUSED");
    expect(() =>
      projectNarration({ voiceId: "system", textSource: "blocks" }, { blocks: [] }, "en-US"),
    ).toThrow("NARRATION_TEXT_MISSING");
  });

  it("validates every published locale in the new immutable bilingual sample", async () => {
    const sources = await Promise.all(
      ["game.json", "locales/zh-CN.json", "locales/en-US.json"].map(async (source) => ({
        source,
        text: await readFile(
          new URL(`../../content/minimal-test-package/1.2.0/${source}`, import.meta.url),
          "utf8",
        ),
      })),
    );
    const result = loadSplitContentPackage(sources, {
      expectedVersion: "1.2.0",
      fileInventory: ["media/videos/ending-balanced.mp4"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    for (const locale of ["zh-CN", "en-US"] as const) {
      expect(
        createGameContentView(result.gameContent, result.localizations[locale]).stories
          .tutorial_voice_order.steps[1],
      ).toHaveProperty("narration.locale", locale);
    }
    const incomplete = JSON.parse(sources[2].text);
    delete incomplete.stories.tutorial_voice_order.steps.order.narrationText;
    sources[2].text = JSON.stringify(incomplete);
    expect(loadSplitContentPackage(sources).issues).toContainEqual(
      expect.objectContaining({ source: "locales/en-US.json", code: "NARRATION_TEXT_MISSING" }),
    );
  });
});
