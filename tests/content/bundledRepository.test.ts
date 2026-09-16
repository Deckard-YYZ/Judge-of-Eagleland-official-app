import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  BundledSplitContentRepository,
  DEFAULT_BUNDLED_CONTENT_REF,
} from "../../src/content/bundledRepository";
import type { BundledPackageFiles } from "../../src/platform/contentResources";
import type { ContentRef } from "../../src/content/schema";

async function installedFiles(
  ref: ContentRef = DEFAULT_BUNDLED_CONTENT_REF,
): Promise<BundledPackageFiles> {
  const root = new URL(`../../content/${ref.packageId}/${ref.version}/`, import.meta.url);
  const fileInventory = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(fileURLToPath(root), join(entry.parentPath, entry.name)).replaceAll("\\", "/"),
    );
  const sources = await Promise.all(
    fileInventory
      .filter((source) => source.endsWith(".json"))
      .map(async (source) => ({ source, text: await readFile(new URL(source, root), "utf8") })),
  );
  return { sources, fileInventory };
}

describe("bundled content repository", () => {
  it("loads installed game and both locales using the exact ref", async () => {
    const reader = vi.fn(installedFiles);
    const repository = new BundledSplitContentRepository(reader);
    expect((await repository.loadGameContent(DEFAULT_BUNDLED_CONTENT_REF)).manifest).toMatchObject(
      DEFAULT_BUNDLED_CONTENT_REF,
    );
    for (const locale of ["en-US", "zh-CN"] as const) {
      expect((await repository.loadLocalization(DEFAULT_BUNDLED_CONTENT_REF, locale)).locale).toBe(
        locale,
      );
    }
    expect(reader).toHaveBeenCalledWith(DEFAULT_BUNDLED_CONTENT_REF);
    expect(DEFAULT_BUNDLED_CONTENT_REF.version).toBe("1.1.0");
    expect((await repository.loadGameContent(DEFAULT_BUNDLED_CONTENT_REF)).stories).toHaveProperty(
      "inspection_after_case_001",
    );
  });

  it("keeps an old save's exact 1.0.0 package available without injecting new story inputs", async () => {
    const oldRef = { packageId: "minimal-test-package", version: "1.0.0" };
    const reader = vi.fn(installedFiles);
    const repository = new BundledSplitContentRepository(reader);
    const content = await repository.loadGameContent(oldRef);
    expect(content.manifest).toMatchObject({ ...oldRef, contentSchemaVersion: 2 });
    expect(content.stories).not.toHaveProperty("inspection_after_case_001");
    for (const locale of ["en-US", "zh-CN"] as const) {
      expect(await repository.loadLocalization(oldRef, locale)).toMatchObject({
        ...oldRef,
        locale,
      });
    }
    expect(reader).toHaveBeenCalledWith(oldRef);
  });

  it("rejects an installed version mismatch, missing asset, or missing locale before returning game content", async () => {
    const files = await installedFiles();
    await expect(
      new BundledSplitContentRepository(async () => files).loadGameContent({
        ...DEFAULT_BUNDLED_CONTENT_REF,
        version: "2.0.0",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONTENT" });
    await expect(
      new BundledSplitContentRepository(async () => ({
        ...files,
        fileInventory: [],
      })).loadGameContent(DEFAULT_BUNDLED_CONTENT_REF),
    ).rejects.toMatchObject({ code: "INVALID_CONTENT" });
    await expect(
      new BundledSplitContentRepository(async () => ({
        ...files,
        sources: files.sources.filter((entry) => entry.source !== "locales/en-US.json"),
      })).loadGameContent(DEFAULT_BUNDLED_CONTENT_REF),
    ).rejects.toMatchObject({ code: "INVALID_CONTENT" });
  });

  it("propagates read failure without fallback and rejects invalid refs before I/O", async () => {
    const reader = vi.fn(async (): Promise<BundledPackageFiles> => {
      throw new Error("missing");
    });
    const repository = new BundledSplitContentRepository(reader);
    await expect(repository.loadGameContent({ packageId: "", version: "1" })).rejects.toMatchObject(
      { code: "INVALID_REF" },
    );
    expect(reader).not.toHaveBeenCalled();
    await expect(repository.loadGameContent(DEFAULT_BUNDLED_CONTENT_REF)).rejects.toMatchObject({
      code: "CONTENT_NOT_FOUND",
    });
    expect(reader).toHaveBeenCalledOnce();
  });

  it("rejects malformed installed JSON with the validator diagnostic", async () => {
    const files = await installedFiles();
    const repository = new BundledSplitContentRepository(async () => ({
      ...files,
      sources: files.sources.map((entry) =>
        entry.source === "game.json" ? { ...entry, text: "{" } : entry,
      ),
    }));
    await expect(repository.loadGameContent(DEFAULT_BUNDLED_CONTENT_REF)).rejects.toMatchObject({
      code: "INVALID_CONTENT",
      cause: expect.arrayContaining([
        expect.objectContaining({ code: "CONTENT_PACKAGE_JSON_INVALID", source: "game.json" }),
      ]),
    });
  });
});
