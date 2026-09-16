import { describe, expect, it } from "vitest";
import { MINIMAL_GAME_CONTENT, MINIMAL_EN_US } from "../../src/content/fixtures/minimalCatalog";
import { ActionInputStepSchema, GameContentCatalogSchema } from "../../src/content/schema";
import {
  validateGameContentCatalog,
  validateLocalizedContentCatalog,
} from "../../src/content/validate";
import { createGameContentView } from "../../src/application/gameContentView";
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
describe("action input content contract", () => {
  it("enforces v3 content, non-skippable inputs and valid effects", () => {
    const content = makeContent();
    expect(validateGameContentCatalog(content).ok).toBe(true);
    content.manifest.contentSchemaVersion = 2;
    expect(GameContentCatalogSchema.safeParse(content).success).toBe(false);
    content.manifest.contentSchemaVersion = 3;
    content.stories.input.skippable = true;
    expect(validateGameContentCatalog(content)).toMatchObject({
      ok: false,
      issues: [{ code: "STORY_INPUT_SKIPPABLE" }],
    });
    content.stories.input.skippable = false;
    content.stories.input.steps = [
      {
        id: "b",
        type: "actionInput",
        targetActionId: "salute",
        wrongEffects: { attributeDeltas: { missing: -1 }, setFlags: { missing: true } },
      },
    ];
    const result = validateGameContentCatalog(content);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["ATTRIBUTE_REFERENCE_INVALID", "FLAG_REFERENCE_INVALID"]),
    );
  });

  it("requires localized input instructions and never projects penalties", () => {
    const content = makeContent();
    const localized = structuredClone(MINIMAL_EN_US);
    localized.stories.input = {
      title: "Input",
      steps: {
        a: { blocks: [{ type: "paragraph", text: "A" }] },
        c: { blocks: [{ type: "paragraph", text: "C" }] },
      },
    };
    expect(validateLocalizedContentCatalog(localized, content).ok).toBe(false);
    localized.stories.input.steps.b = { blocks: [{ type: "paragraph", text: "Salute." }] };
    expect(validateLocalizedContentCatalog(localized, content).ok).toBe(true);
    expect(createGameContentView(content, localized).stories.input.steps[1]).toEqual({
      id: "b",
      type: "actionInput",
      targetActionId: "salute",
      blocks: [{ type: "paragraph", text: "Salute." }],
    });
  });
  it.each([
    { targetActionId: "bow" },
    { onSuccess: {} },
    { wrongEffects: { attributeDeltas: { authority: -1.5 }, setFlags: {} } },
    { wrongEffects: { attributeDeltas: {}, setFlags: {}, arbitrary: true } },
  ])("rejects unsupported action/effect contracts: %j", (patch) => {
    expect(
      ActionInputStepSchema.safeParse({
        id: "b",
        type: "actionInput",
        targetActionId: "salute",
        ...patch,
      }).success,
    ).toBe(false);
  });
});
