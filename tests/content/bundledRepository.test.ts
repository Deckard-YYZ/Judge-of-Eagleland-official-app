import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  BundledSplitContentRepository,
  DEFAULT_BUNDLED_CONTENT_REF,
} from "../../src/content/bundledRepository";
import type { BundledPackageFiles } from "../../src/platform/contentResources";

async function installedFiles(): Promise<BundledPackageFiles> {
  const root = new URL("../../content/minimal-test-package/1.0.0/", import.meta.url);
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
    const files = await installedFiles();
    const reader = vi.fn(async () => files);
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
