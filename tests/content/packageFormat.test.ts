import { describe, expect, it } from "vitest";
import {
  MINIMAL_EN_US,
  MINIMAL_GAME_CONTENT,
  MINIMAL_ZH_CN,
} from "../../src/content/fixtures/minimalCatalog";
import {
  loadSplitContentPackage,
  type ContentPackageSource,
} from "../../src/content/localizedPackageFormat";

const packageSources = (): ContentPackageSource[] => [
  { source: "game.json", text: JSON.stringify(MINIMAL_GAME_CONTENT) },
  { source: "locales/zh-CN.json", text: JSON.stringify(MINIMAL_ZH_CN) },
  { source: "locales/en-US.json", text: JSON.stringify(MINIMAL_EN_US) },
];

const failureIssues = (sources: readonly ContentPackageSource[]) => {
  const result = loadSplitContentPackage(sources);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected package loading to fail.");
  return result.issues;
};

describe("loadSplitContentPackage", () => {
  it("loads a complete package independent of input order without mutation", () => {
    const sources = packageSources().reverse();
    const before = structuredClone(sources);
    const result = loadSplitContentPackage(sources, {
      expectedPackageId: "minimal-test-package",
      expectedVersion: "1.0.0",
      fileInventory: ["media/videos/ending-balanced.mp4"],
    });
    expect(result.ok).toBe(true);
    expect(sources).toEqual(before);
    if (result.ok) {
      expect(result.gameContent).toEqual(MINIMAL_GAME_CONTENT);
      expect(result.localizations["en-US"]).toEqual(MINIMAL_EN_US);
    }
  });

  it("reports a missing rules file and every missing declared locale", () => {
    expect(
      failureIssues(packageSources().filter(({ source }) => source !== "game.json")),
    ).toContainEqual(
      expect.objectContaining({ code: "CONTENT_PACKAGE_FILE_MISSING", source: "game.json" }),
    );
    expect(
      failureIssues(packageSources().filter(({ source }) => source !== "locales/en-US.json")),
    ).toContainEqual(
      expect.objectContaining({
        code: "CONTENT_PACKAGE_FILE_MISSING",
        source: "locales/en-US.json",
      }),
    );
  });

  it("rejects duplicate, malformed, and unrecognized package files deterministically", () => {
    const duplicate = packageSources();
    duplicate.push({ ...duplicate[0] });
    expect(failureIssues(duplicate)).toContainEqual(
      expect.objectContaining({ code: "CONTENT_PACKAGE_FILE_DUPLICATE", source: "game.json" }),
    );

    const malformed = packageSources();
    malformed[1] = { source: "locales/zh-CN.json", text: "{" };
    expect(failureIssues(malformed)).toContainEqual(
      expect.objectContaining({
        code: "CONTENT_PACKAGE_JSON_INVALID",
        source: "locales/zh-CN.json",
      }),
    );

    const unknown = packageSources();
    unknown.push({ source: "notes.json", text: "{}" });
    expect(failureIssues(unknown)).toContainEqual(
      expect.objectContaining({
        code: "CONTENT_PACKAGE_FILE_UNRECOGNIZED",
        source: "notes.json",
      }),
    );
  });

  it("maps rules and localized schema failures to their owning source", () => {
    const badGame = structuredClone(MINIMAL_GAME_CONTENT) as any;
    badGame.cases.case_001.id = "";
    const gameSources = packageSources();
    gameSources[0] = { source: "game.json", text: JSON.stringify(badGame) };
    expect(failureIssues(gameSources)[0]).toMatchObject({
      code: "GAME_CONTENT_SCHEMA_INVALID",
      source: "game.json",
      path: ["cases", "case_001", "id"],
    });

    const badLocale = structuredClone(MINIMAL_EN_US) as any;
    delete badLocale.cases.case_001.choices.formal_warning;
    const localeSources = packageSources();
    localeSources[2] = {
      source: "locales/en-US.json",
      text: JSON.stringify(badLocale),
    };
    expect(failureIssues(localeSources)).toContainEqual(
      expect.objectContaining({
        code: "LOCALIZATION_ID_MISSING",
        source: "locales/en-US.json",
        path: ["cases", "case_001", "choices", "formal_warning"],
      }),
    );
  });

  it("rejects expected package identity mismatches at game.json", () => {
    const result = loadSplitContentPackage(packageSources(), {
      expectedPackageId: "other-package",
      expectedVersion: "2.0.0",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map(({ code, source }) => ({ code, source }))).toEqual([
        { code: "MANIFEST_PACKAGE_ID_MISMATCH", source: "game.json" },
        { code: "MANIFEST_VERSION_MISMATCH", source: "game.json" },
      ]);
    }
  });
});
