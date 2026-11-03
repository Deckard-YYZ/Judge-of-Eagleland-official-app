import { describe, expect, it, vi } from "vitest";
import { checkAllContent, parseAuthorPackageRegistry } from "../../scripts/content/check-all";
import type { BuildOptions } from "../../scripts/content/build";

const registry = [
  { source: "content-authoring/samples/schema4", output: "content/configuration-skeleton/0.1.0" },
  { source: "content-authoring/samples/schema5", output: "content/configuration-pilot/0.1.3" },
  { source: "content-authoring/samples/full", output: "content/configuration-complete/0.1.0" },
  { source: "content-authoring/samples/mainflow-short", output: "content/mainflow-short/0.1.3" },
];

describe("complete authoring generation gate", () => {
  it("fails rather than silently skipping when the real tool is missing", async () => {
    const build = vi.fn();
    await expect(checkAllContent(undefined, { registry, build })).rejects.toThrow(
      "LUBAN_ROOT_REQUIRED",
    );
    await expect(checkAllContent(" ", { registry, build })).rejects.toThrow("LUBAN_ROOT_REQUIRED");
    expect(build).not.toHaveBeenCalled();
  });

  it("checks every explicit registration sequentially, using real regeneration mode", async () => {
    let pending = false;
    const build = vi.fn(async (_options: BuildOptions) => {
      expect(pending).toBe(false);
      pending = true;
      await Promise.resolve();
      pending = false;
    });
    expect(await checkAllContent("tool", { registry, build })).toEqual(
      registry.map((entry) => entry.output),
    );
    expect(build).toHaveBeenCalledTimes(4);
    for (const [options] of build.mock.calls) expect(options).toMatchObject({ check: true });
  });

  it("stops and propagates a generation failure instead of claiming all packages passed", async () => {
    const build = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("OUTPUT_DRIFT: media/image.png"));
    await expect(checkAllContent("tool", { registry, build })).rejects.toThrow("OUTPUT_DRIFT");
    expect(build).toHaveBeenCalledTimes(2);
  });

  it.each(
    [
      [{ source: "../outside", output: "content/package/1.0.0" }],
      [{ source: "content-authoring/samples/full", output: "content/../package/1.0.0" }],
      [{ source: "C:/source", output: "content/package/1.0.0" }],
      [{ source: "content-authoring/samples/full", output: "content/package/1.0.0/extra" }],
      [...registry, registry[0]],
      [registry[0], { source: "content-authoring/samples/Schema4", output: "content/other/1.0.0" }],
      [
        registry[0],
        {
          source: "content-authoring/samples/other",
          output: "content/Configuration-Skeleton/0.1.0",
        },
      ],
    ].map((entries) => ({ entries })),
  )("rejects unsafe or duplicate registry paths before invoking a tool", async ({ entries }) => {
    const build = vi.fn();
    await expect(checkAllContent("tool", { registry: entries, build })).rejects.toThrow();
    expect(build).not.toHaveBeenCalled();
  });

  it("keeps the committed registry explicit and complete", async () => {
    const contents = await import("../../scripts/content/packages.json");
    expect(parseAuthorPackageRegistry(contents.default)).toEqual(registry);
  });
});
