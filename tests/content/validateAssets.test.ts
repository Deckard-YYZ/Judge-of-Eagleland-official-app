import { describe, expect, it } from "vitest";
import {
  MINIMAL_EN_US,
  MINIMAL_GAME_CONTENT,
  MINIMAL_ZH_CN,
} from "../../src/content/fixtures/minimalCatalog";
import {
  loadSplitContentPackage,
  type ContentPackageLoadOptions,
  type ContentPackageSource,
} from "../../src/content/localizedPackageFormat";
import type { GameContentCatalog } from "../../src/content/schema";
import { validateGameContentCatalog } from "../../src/content/validate";

const cloneCatalog = (): GameContentCatalog => structuredClone(MINIMAL_GAME_CONTENT);
const packageSources = (gameContent = cloneCatalog()): ContentPackageSource[] => [
  { source: "game.json", text: JSON.stringify(gameContent) },
  { source: "locales/zh-CN.json", text: JSON.stringify(MINIMAL_ZH_CN) },
  { source: "locales/en-US.json", text: JSON.stringify(MINIMAL_EN_US) },
];

const packageFailure = (
  sources: readonly ContentPackageSource[],
  options: ContentPackageLoadOptions = {},
) => {
  const result = loadSplitContentPackage(sources, options);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected package validation to fail.");
  return result.issues;
};

describe("schema-v2 content asset validation", () => {
  it("accepts normalized package paths without inferring kinds from extensions", () => {
    const catalog = cloneCatalog();
    catalog.assets.ending_balanced_video.path = "media/raw/ending.payload";
    catalog.assets.unused_audio = { kind: "audio", path: "media/audio/unused.mp4" };
    expect(
      validateGameContentCatalog(catalog, {
        fileInventory: ["media/raw/ending.payload", "media/audio/unused.mp4"],
      }),
    ).toMatchObject({ ok: true, issues: [] });
  });

  it("reports missing and wrongly typed video references at game.json", () => {
    const missing = cloneCatalog();
    const video = missing.stories.ending_balanced.steps[0];
    if (video.type !== "video") throw new Error("Expected fixture video step.");
    video.assetId = "missing_video";
    expect(packageFailure(packageSources(missing))).toContainEqual(
      expect.objectContaining({
        code: "ASSET_REFERENCE_INVALID",
        source: "game.json",
        path: ["stories", "ending_balanced", "steps", 0, "assetId"],
      }),
    );

    const wrongKind = cloneCatalog();
    wrongKind.assets.ending_balanced_video.kind = "image";
    expect(packageFailure(packageSources(wrongKind))).toContainEqual(
      expect.objectContaining({ code: "ASSET_KIND_INVALID", source: "game.json" }),
    );
  });

  it.each([
    ["POSIX absolute", "/media/video.mp4"],
    ["Windows drive", "C:/media/video.mp4"],
    ["backslash", "media\\videos\\video.mp4"],
    ["UNC path", "\\\\server\\share\\video.mp4"],
    ["parent traversal", "media/../video.mp4"],
    ["current-directory segment", "media/./video.mp4"],
    ["empty middle segment", "media//video.mp4"],
    ["empty trailing segment", "media/videos/"],
    ["URL", "https://example.test/video.mp4"],
    ["URL scheme", "file:media/video.mp4"],
    ["query", "media/video.mp4?download=1"],
    ["fragment", "media/video.mp4#clip"],
    ["control character", "media/\u0000video.mp4"],
  ])("rejects %s asset paths without file-missing cascades", (_label, path) => {
    const catalog = cloneCatalog();
    catalog.assets.ending_balanced_video.path = path;
    const result = validateGameContentCatalog(catalog, { fileInventory: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((entry) => entry.code)).toEqual(["ASSET_PATH_INVALID"]);
      expect(result.issues[0].path).toEqual(["assets", "ending_balanced_video", "path"]);
    }
  });

  it("checks legal paths only when an inventory is explicitly supplied", () => {
    expect(packageFailure(packageSources(), { fileInventory: [] })).toContainEqual(
      expect.objectContaining({
        code: "ASSET_FILE_MISSING",
        source: "game.json",
        path: ["assets", "ending_balanced_video", "path"],
      }),
    );
    expect(loadSplitContentPackage(packageSources())).toMatchObject({ ok: true, issues: [] });
  });
});
