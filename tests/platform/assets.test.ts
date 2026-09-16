import { describe, expect, it, vi } from "vitest";

import {
  createAssetResolver,
  type AssetCatalogLike,
  type AssetKind,
} from "../../src/platform/assets";

const catalogFor = (path = "media/videos/ending.mp4"): AssetCatalogLike => ({
  manifest: { packageId: "base-story", version: "1.0.0" },
  assets: { ending: { kind: "video", path } },
});

describe("asset resolver", () => {
  it("maps browser assets through the package and manifest version", async () => {
    const resolver = createAssetResolver({ runtime: "browser" });

    await expect(resolver.resolve(catalogFor(), "ending")).resolves.toBe(
      "/content/base-story/1.0.0/media/videos/ending.mp4",
    );
  });

  it("URL-encodes Unicode and spaces without changing package separators", async () => {
    const resolver = createAssetResolver({ runtime: "browser", browserBaseUrl: "/preview/" });

    await expect(resolver.resolve(catalogFor("media/人物 portrait.mp4"), "ending")).resolves.toBe(
      "/preview/base-story/1.0.0/media/%E4%BA%BA%E7%89%A9%20portrait.mp4",
    );
  });

  it("uses Tauri's resource path and asset protocol at the platform boundary", async () => {
    const resolveResource = vi.fn(async (resourcePath: string) => `C:\\app\\${resourcePath}`);
    const convertFileSrc = vi.fn((filePath: string) => `asset://localhost/${filePath}`);
    const resolver = createAssetResolver({
      runtime: "tauri",
      resolveResource,
      convertFileSrc,
    });

    await expect(resolver.resolve(catalogFor(), "ending")).resolves.toBe(
      "asset://localhost/C:\\app\\content/base-story/1.0.0/media/videos/ending.mp4",
    );
    expect(resolveResource).toHaveBeenCalledWith(
      "content/base-story/1.0.0/media/videos/ending.mp4",
    );
    expect(convertFileSrc).toHaveBeenCalledWith(
      "C:\\app\\content/base-story/1.0.0/media/videos/ending.mp4",
    );
  });

  it("reports an unknown asset ID without touching the resource resolver", async () => {
    const resolveResource = vi.fn(async (resourcePath: string) => resourcePath);
    const resolver = createAssetResolver({ runtime: "tauri", resolveResource });

    await expect(resolver.resolve(catalogFor(), "missing")).rejects.toMatchObject({
      code: "ASSET_NOT_FOUND",
    });
    expect(resolveResource).not.toHaveBeenCalled();
  });

  it.each([
    ["packageId", "base%2fstory"],
    ["version", "1.%2e0"],
  ])("rejects encoded content reference %s", async (field, value) => {
    const original = catalogFor();
    const catalog: AssetCatalogLike = {
      ...original,
      manifest: {
        ...original.manifest,
        [field]: value,
      },
    };
    const resolver = createAssetResolver({ runtime: "browser" });

    await expect(resolver.resolve(catalog, "ending")).rejects.toMatchObject({
      code: "INVALID_REF",
    });
  });

  it.each([
    ["POSIX absolute", "/media/video.mp4"],
    ["Windows drive", "C:/media/video.mp4"],
    ["UNC path", "\\\\server\\share\\video.mp4"],
    ["backslash", "media\\videos\\video.mp4"],
    ["parent traversal", "media/../video.mp4"],
    ["current-directory segment", "media/./video.mp4"],
    ["empty segment", "media//video.mp4"],
    ["trailing slash", "media/videos/"],
    ["URL", "https://example.test/video.mp4"],
    ["URL scheme", "file:media/video.mp4"],
    ["Windows alternate data stream", "media/video.mp4:metadata"],
    ["trailing dot", "media/video.mp4."],
    ["trailing space", "media/video.mp4 "],
    ["encoded traversal", "media/%2e%2e/video.mp4"],
    ["encoded separator", "media/%2fvideo.mp4"],
    ["query", "media/video.mp4?download=1"],
    ["fragment", "media/video.mp4#clip"],
    ["wildcard", "media/*/video.mp4"],
    ["control character", "media/\u0000video.mp4"],
    ["Windows reserved device name", "media/CON/video.mp4"],
    ["Windows reserved device name with extension", "media/com1.txt/video.mp4"],
  ])("rejects %s asset paths before resolving", async (_label, path) => {
    const resolveResource = vi.fn(async (resourcePath: string) => resourcePath);
    const resolver = createAssetResolver({ runtime: "tauri", resolveResource });

    await expect(resolver.resolve(catalogFor(path), "ending")).rejects.toMatchObject({
      code: "ASSET_PATH_INVALID",
    });
    expect(resolveResource).not.toHaveBeenCalled();
  });

  it("rejects an unpaired UTF-16 surrogate before URL encoding or native resolution", async () => {
    const resolveResource = vi.fn(async (resourcePath: string) => resourcePath);
    const resolver = createAssetResolver({ runtime: "tauri", resolveResource });
    const malformedPath = `media/${String.fromCharCode(0xd800)}.mp4`;

    await expect(resolver.resolve(catalogFor(malformedPath), "ending")).rejects.toMatchObject({
      code: "ASSET_PATH_INVALID",
    });
    expect(resolveResource).not.toHaveBeenCalled();
  });

  it("validates the asset kind at runtime", async () => {
    const resolveResource = vi.fn(async (resourcePath: string) => resourcePath);
    const invalidCatalog: AssetCatalogLike = {
      ...catalogFor(),
      assets: {
        ending: {
          kind: "script" as AssetKind,
          path: "media/videos/ending.mp4",
        },
      },
    };
    const resolver = createAssetResolver({ runtime: "tauri", resolveResource });

    await expect(resolver.resolve(invalidCatalog, "ending")).rejects.toMatchObject({
      code: "ASSET_KIND_INVALID",
    });
    expect(resolveResource).not.toHaveBeenCalled();
  });

  it.each([
    ["remote URL", "https://cdn.example.test/content/"],
    ["protocol-relative URL", "//cdn.example.test/content/"],
    ["dot traversal", "/content/../private/"],
    ["encoded traversal", "/content/%2e%2e/private/"],
    ["backslash", "/content\\private/"],
    ["query", "/content/?v=1"],
    ["fragment", "/content/#asset"],
    ["Windows drive", "C:/content/"],
  ])("rejects an unsafe browser base: %s", (_label, base) => {
    expect(() => createAssetResolver({ runtime: "browser", browserBaseUrl: base })).toThrow(
      /Browser asset base/,
    );
  });

  it("wraps resource resolution failures with a stable platform error", async () => {
    const resolver = createAssetResolver({
      runtime: "tauri",
      resolveResource: vi.fn(async () => {
        throw new Error("missing bundled file");
      }),
    });

    await expect(resolver.resolve(catalogFor(), "ending")).rejects.toMatchObject({
      code: "ASSET_RESOLUTION_FAILED",
    });
  });

  it("wraps empty native resolver and converter results", async () => {
    const emptyResourceResolver = createAssetResolver({
      runtime: "tauri",
      resolveResource: vi.fn(async () => ""),
    });
    await expect(emptyResourceResolver.resolve(catalogFor(), "ending")).rejects.toMatchObject({
      code: "ASSET_RESOLUTION_FAILED",
    });

    const emptyUrlConverter = createAssetResolver({
      runtime: "tauri",
      resolveResource: vi.fn(async () => "C:\\app\\asset.mp4"),
      convertFileSrc: vi.fn(() => ""),
    });
    await expect(emptyUrlConverter.resolve(catalogFor(), "ending")).rejects.toMatchObject({
      code: "ASSET_RESOLUTION_FAILED",
    });
  });
});
