import { describe, expect, it } from "vitest";
import { createGameContentView } from "../../src/application/gameContentView";
import {
  MINIMAL_EN_US,
  MINIMAL_GAME_CONTENT,
  MINIMAL_LOCALIZATIONS,
  MINIMAL_ZH_CN,
} from "../../src/content/fixtures/minimalCatalog";
import { FakeSplitContentRepository } from "../../src/content/repository";
import { loadSplitContentPackage } from "../../src/content/localizedPackageFormat";
import { ContentRefSchema, LocalizedContentCatalogSchema } from "../../src/content/schema";
import {
  validateGameContentCatalog,
  validateLocalizedContentCatalog,
} from "../../src/content/validate";

const cloneGame = () => structuredClone(MINIMAL_GAME_CONTENT);
const cloneLocale = () => structuredClone(MINIMAL_EN_US);

describe("schema-v2 localized content", () => {
  it("validates complete Chinese and English catalogs independently of game facts", () => {
    expect(validateGameContentCatalog(MINIMAL_GAME_CONTENT)).toMatchObject({ ok: true });
    expect(validateLocalizedContentCatalog(MINIMAL_ZH_CN, MINIMAL_GAME_CONTENT)).toMatchObject({
      ok: true,
    });
    expect(validateLocalizedContentCatalog(MINIMAL_EN_US, MINIMAL_GAME_CONTENT)).toMatchObject({
      ok: true,
    });
    expect(
      ContentRefSchema.safeParse({ ...MINIMAL_GAME_CONTENT.manifest, locale: "en-US" }).success,
    ).toBe(false);
  });

  it("makes business fields structurally impossible in a localization catalog", () => {
    const localized: any = cloneLocale();
    localized.cases.case_001.choices.formal_warning.target = {
      type: "resolution",
      resolutionId: "warning",
    };
    localized.cases.case_001.resolutions.warning.effects = { attributeDeltas: {} };
    localized.stories.ending_balanced.steps.closing_video.assetId = "ending_balanced_video";

    const parsed = LocalizedContentCatalogSchema.safeParse(localized);
    expect(parsed.success).toBe(false);
    const result = validateLocalizedContentCatalog(localized, MINIMAL_GAME_CONTENT, {
      source: "locales/en-US.json",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(new Set(result.issues.map((issue) => issue.code))).toEqual(
        new Set(["LOCALIZATION_SCHEMA_INVALID"]),
      );
      expect(result.issues.every((issue) => issue.source === "locales/en-US.json")).toBe(true);
    }
  });

  it("rejects display copy from the unique rules catalog", () => {
    const game: any = cloneGame();
    game.manifest.title = "Presentation does not belong here";
    game.attributes.restraint.label = "Restraint";
    game.cases.case_001.title = "Case title";
    game.cases.case_001.nodes.assessment.prompt = "Prompt";

    const result = validateGameContentCatalog(game);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(4);
      expect(result.issues.every((issue) => issue.code === "GAME_CONTENT_SCHEMA_INVALID")).toBe(
        true,
      );
    }
  });

  it("reports missing and extra stable ids, annotation drift, and invalid text", () => {
    const localized: any = cloneLocale();
    delete localized.attributes.restraint;
    localized.attributes.unknown = { label: "Unknown" };
    delete localized.cases.case_001.nodes.assessment;
    localized.cases.case_001.nodes.unknown = { prompt: "Unknown" };
    delete localized.cases.case_001.choices.formal_warning;
    localized.cases.case_001.choices.extra = { text: "Extra" };
    delete localized.cases.case_001.choices.insufficient_evidence.annotation;

    const result = validateLocalizedContentCatalog(localized, MINIMAL_GAME_CONTENT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining([
          "LOCALIZATION_ID_MISSING",
          "LOCALIZATION_ID_EXTRA",
          "LOCALIZATION_ANNOTATION_MISMATCH",
        ]),
      );
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["attributes", "restraint"] }),
          expect.objectContaining({ path: ["cases", "case_001", "nodes", "assessment"] }),
          expect.objectContaining({ path: ["cases", "case_001", "choices", "formal_warning"] }),
        ]),
      );
    }

    const malformed: any = cloneLocale();
    malformed.cases.case_001.body[0].type = "html";
    expect(validateLocalizedContentCatalog(malformed, MINIMAL_GAME_CONTENT)).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: "LOCALIZATION_SCHEMA_INVALID" })],
    });
  });

  it("rejects package, version, locale identity, and undeclared locale mismatches", () => {
    const game = cloneGame();
    game.manifest.supportedLocales = ["zh-CN"];
    const localized = cloneLocale();
    localized.packageId = "another-package";
    localized.version = "9.0.0";

    const result = validateLocalizedContentCatalog(localized, game, {
      expectedLocale: "zh-CN",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(new Set(result.issues.map((issue) => issue.code))).toEqual(
        new Set([
          "LOCALIZATION_PACKAGE_ID_MISMATCH",
          "LOCALIZATION_VERSION_MISMATCH",
          "LOCALIZATION_LOCALE_UNSUPPORTED",
          "LOCALIZATION_LOCALE_MISMATCH",
        ]),
      );
    }
  });

  it("composes locale presentation while preserving all rules and structural order", () => {
    const zh = createGameContentView(MINIMAL_GAME_CONTENT, MINIMAL_ZH_CN);
    const en = createGameContentView(MINIMAL_GAME_CONTENT, MINIMAL_EN_US);

    expect(zh.cases.case_001.title).toContain("夜间档案室");
    expect(en.cases.case_001.title).toContain("Night Archive");
    expect(en.cases.case_001.nodes.assessment.choices.map(({ id }) => id)).toEqual(
      zh.cases.case_001.nodes.assessment.choices.map(({ id }) => id),
    );
    expect(en.cases.case_001.nodes.assessment.choices[0]).not.toHaveProperty("target");
    expect(en.cases.case_001.resolutions.warning).not.toHaveProperty("effects");
  });

  it("loads rules and locale through separate repository dimensions", async () => {
    const repository = new FakeSplitContentRepository([
      { gameContent: MINIMAL_GAME_CONTENT, localizations: MINIMAL_LOCALIZATIONS },
    ]);
    const ref = { packageId: "minimal-test-package", version: "1.0.0" };

    const game = await repository.loadGameContent(ref);
    const localized = await repository.loadLocalization(ref, "en-US");
    const view = createGameContentView(game, localized);

    expect(game.cases.case_001.nodes.assessment.choices[0]).not.toHaveProperty("text");
    expect(localized.cases.case_001.choices.insufficient_evidence).not.toHaveProperty("target");
    expect(view.cases.case_001.title).toContain("Night Archive");
  });

  it("loads the schema-v2 physical format and requires every declared locale file", () => {
    const sources = [
      { source: "game.json", text: JSON.stringify(MINIMAL_GAME_CONTENT) },
      { source: "locales/zh-CN.json", text: JSON.stringify(MINIMAL_ZH_CN) },
      { source: "locales/en-US.json", text: JSON.stringify(MINIMAL_EN_US) },
    ];
    const loaded = loadSplitContentPackage(sources, {
      expectedPackageId: "minimal-test-package",
      expectedVersion: "1.0.0",
    });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.gameContent.cases.case_001).not.toHaveProperty("title");
      expect(loaded.localizations["en-US"].cases.case_001).not.toHaveProperty("order");
      expect(loaded.localizations["zh-CN"].cases.case_001.title).toContain("夜间档案室");
    }

    const missing = loadSplitContentPackage(sources.slice(0, 2));
    expect(missing).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "CONTENT_PACKAGE_FILE_MISSING",
          source: "locales/en-US.json",
        }),
      ],
    });
  });
});
