import { describe, expect, it } from "vitest";

import { MINIMAL_CATALOG } from "../../src/content/fixtures/minimalCatalog";
import {
  loadContentPackage,
  type ContentPackageLoadOptions,
  type ContentPackageSource,
} from "../../src/content/packageFormat";
import type { ContentCatalog } from "../../src/content/schema";
import { validateContentCatalog } from "../../src/content/validate";

const cloneCatalog = (): ContentCatalog => structuredClone(MINIMAL_CATALOG);

const packageSources = (catalog = cloneCatalog()): ContentPackageSource[] => [
  { source: "manifest.json", text: JSON.stringify(catalog.manifest) },
  { source: "attributes.json", text: JSON.stringify(catalog.attributes) },
  { source: "initial.json", text: JSON.stringify(catalog.initial) },
  {
    source: "progression.json",
    text: JSON.stringify({
      unlockRules: catalog.unlockRules,
      storyRules: catalog.storyRules,
    }),
  },
  { source: "endings.json", text: JSON.stringify(catalog.endings) },
  { source: "assets.json", text: JSON.stringify(catalog.assets) },
  ...Object.entries(catalog.cases).map(([id, definition]) => ({
    source: `cases/${id}.json`,
    text: JSON.stringify(definition),
  })),
  ...Object.entries(catalog.stories).map(([id, story]) => ({
    source: `stories/${id}.json`,
    text: JSON.stringify(story),
  })),
];

const packageFailure = (
  sources: readonly ContentPackageSource[],
  options: ContentPackageLoadOptions = {},
) => {
  const result = loadContentPackage(sources, options);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected package validation to fail.");
  }
  return result.issues;
};

describe("content asset validation", () => {
  it("accepts normalized package paths without inferring kinds from extensions", () => {
    const catalog = cloneCatalog();
    catalog.assets.ending_balanced_video.path = "media/raw/ending.payload";
    catalog.assets.unused_audio = { kind: "audio", path: "media/audio/unused.mp4" };
    const inventory = ["media/raw/ending.payload", "media/audio/unused.mp4"];

    expect(validateContentCatalog(catalog, { fileInventory: inventory })).toMatchObject({
      ok: true,
      issues: [],
    });
  });

  it("reports a missing video asset reference at the owning story file", () => {
    const catalog = cloneCatalog();
    const video = catalog.stories.ending_balanced.steps[0];
    if (video.type !== "video") {
      throw new Error("Expected fixture video step.");
    }
    video.assetId = "missing_video";

    expect(packageFailure(packageSources(catalog))).toContainEqual(
      expect.objectContaining({
        code: "ASSET_REFERENCE_INVALID",
        source: "stories/ending_balanced.json",
        objectId: "ending_balanced",
        path: ["stories", "ending_balanced", "steps", 0, "assetId"],
      }),
    );
  });

  it("requires every video step target to declare kind video", () => {
    const catalog = cloneCatalog();
    catalog.assets.ending_balanced_video.kind = "image";

    expect(packageFailure(packageSources(catalog))).toContainEqual(
      expect.objectContaining({
        code: "ASSET_KIND_INVALID",
        source: "stories/ending_balanced.json",
        objectId: "ending_balanced",
        path: ["stories", "ending_balanced", "steps", 0, "assetId"],
      }),
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
  ])("rejects %s asset paths without cascading to file-missing", (_label, path) => {
    const catalog = cloneCatalog();
    catalog.assets.ending_balanced_video.path = path;

    const result = validateContentCatalog(catalog, { fileInventory: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toEqual(["ASSET_PATH_INVALID"]);
      expect(result.issues[0].path).toEqual(["assets", "ending_balanced_video", "path"]);
    }
  });

  it("maps invalid asset paths to assets.json", () => {
    const catalog = cloneCatalog();
    catalog.assets.ending_balanced_video.path = "media/../outside.mp4";

    expect(packageFailure(packageSources(catalog), { fileInventory: [] })).toContainEqual(
      expect.objectContaining({
        code: "ASSET_PATH_INVALID",
        source: "assets.json",
        objectId: "ending_balanced_video",
        path: ["assets", "ending_balanced_video", "path"],
      }),
    );
  });

  it("checks legal asset paths against an explicitly supplied inventory", () => {
    const sources = packageSources();

    expect(packageFailure(sources, { fileInventory: [] })).toContainEqual(
      expect.objectContaining({
        code: "ASSET_FILE_MISSING",
        source: "assets.json",
        objectId: "ending_balanced_video",
        path: ["assets", "ending_balanced_video", "path"],
      }),
    );
  });

  it("does not assume physical file absence when inventory is omitted", () => {
    expect(loadContentPackage(packageSources())).toMatchObject({ ok: true, issues: [] });
  });

  it("reports expected package and version mismatches at manifest.json", () => {
    const issues = packageFailure(packageSources(), {
      expectedPackageId: "other-package",
      expectedVersion: "2.0.0",
    });

    expect(
      issues.map(({ code, source, objectId, path }) => ({ code, source, objectId, path })),
    ).toEqual([
      {
        code: "MANIFEST_PACKAGE_ID_MISMATCH",
        source: "manifest.json",
        objectId: "manifest",
        path: ["manifest", "packageId"],
      },
      {
        code: "MANIFEST_VERSION_MISMATCH",
        source: "manifest.json",
        objectId: "manifest",
        path: ["manifest", "version"],
      },
    ]);
  });

  it("does not mutate package sources, inventory, or expected identity options", () => {
    const sources = packageSources();
    const options: ContentPackageLoadOptions = {
      fileInventory: ["media/videos/ending-balanced.mp4"],
      expectedPackageId: "minimal-test-package",
      expectedVersion: "1.0.0",
    };
    const beforeSources = structuredClone(sources);
    const beforeOptions = structuredClone(options);

    expect(loadContentPackage(sources, options)).toMatchObject({ ok: true, issues: [] });
    expect(sources).toEqual(beforeSources);
    expect(options).toEqual(beforeOptions);
  });
});
