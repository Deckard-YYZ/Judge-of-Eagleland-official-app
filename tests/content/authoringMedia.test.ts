import { cp, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AssetDefinition } from "../../src/content/schema";
import { buildContent, publish } from "../../scripts/content/build";
import { readAuthoringMedia } from "../../scripts/content/media";

async function scratch() {
  const root = path.resolve("artifacts/content-authoring/media-tests");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "test-"));
  const source = path.join(directory, "source");
  await mkdir(path.join(source, "media"), { recursive: true });
  return { directory, source };
}
const asset = (filename: string): Record<string, AssetDefinition> => ({
  image: { kind: "image", path: filename },
});

describe("author media and immutable binary publication", () => {
  it("preserves original non-UTF8 bytes, shares identical paths, and detects binary drift", async () => {
    const { directory, source } = await scratch();
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff, 0xfe]);
    await writeFile(path.join(source, "media/image.png"), bytes);
    const media = await readAuthoringMedia(source, {
      ...asset("media/image.png"),
      same: { kind: "image", path: "media/image.png" },
    });
    expect([...media.keys()]).toEqual(["media/image.png"]);
    const files = new Map<string, string | Uint8Array>([["game.json", "{}\n"], ...media]);
    const output = path.join(directory, "package/1.0.0");
    await publish(files, output, path.join(directory, "stage"), false);
    expect(await readFile(path.join(output, "media/image.png"))).toEqual(bytes);
    await publish(files, output, path.join(directory, "unused"), true);
    files.set("media/image.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xfe, 0xff]));
    await expect(publish(files, output, path.join(directory, "unused"), true)).rejects.toThrow(
      "OUTPUT_DRIFT: media/image.png",
    );
    await expect(publish(files, output, path.join(directory, "unused"), false)).rejects.toThrow(
      "OUTPUT_DRIFT",
    );
    expect(await readFile(path.join(output, "media/image.png"))).toEqual(bytes);
    files.delete("media/image.png");
    await expect(publish(files, output, path.join(directory, "unused"), true)).rejects.toThrow(
      "file inventory differs",
    );
  }, 120_000);

  it.each([
    "../image.png",
    "media/../image.png",
    "media/./image.png",
    "media//image.png",
    "media\\image.png",
    "/media/image.png",
    "C:/media/image.png",
    "media/%2e%2e/image.png",
    "media/image.png?version=1",
    "media/image.png#fragment",
    "media/NUL.png",
    "media/image.png.",
    "locales/image.png",
  ])("rejects unsafe or non-media source %s", async (filename) => {
    const { source } = await scratch();
    await expect(readAuthoringMedia(source, asset(filename))).rejects.toThrow(
      /MEDIA_SOURCE_INVALID.*asset=image/,
    );
  });

  it("rejects missing files and directory assets before publishing either a new or changed package", async () => {
    const { directory, source } = await scratch();
    const output = path.join(directory, "package/1.0.0");
    await publish(
      new Map([["game.json", "old\n"]]),
      output,
      path.join(directory, "old-stage"),
      false,
    );
    const attempt = async (target: string, filename: string) => {
      const media = await readAuthoringMedia(source, asset(filename));
      await publish(
        new Map<string, string | Uint8Array>([["game.json", "new\n"], ...media]),
        target,
        path.join(directory, "never-stage"),
        false,
      );
    };
    for (const target of [output, path.join(directory, "package/2.0.0")])
      await expect(attempt(target, "media/missing.png")).rejects.toThrow("MEDIA_SOURCE_INVALID");
    await mkdir(path.join(source, "media/directory.png"));
    await expect(attempt(output, "media/directory.png")).rejects.toThrow("regular file");
    expect(await readFile(path.join(output, "game.json"), "utf8")).toBe("old\n");
    expect(await readdir(path.join(directory, "package"))).toEqual(["1.0.0"]);
  }, 30_000);

  it("rejects media directory links both within and outside the source root", async () => {
    const { directory, source } = await scratch();
    for (const [name, target] of [
      ["inside", path.join(source, "real")],
      ["outside", path.join(directory, "external")],
    ]) {
      await mkdir(target);
      await writeFile(path.join(target, "image.png"), "image");
      await symlink(
        target,
        path.join(source, "media", name),
        process.platform === "win32" ? "junction" : "dir",
      );
      await expect(readAuthoringMedia(source, asset(`media/${name}/image.png`))).rejects.toThrow(
        "PACKAGE_LINK_UNSUPPORTED",
      );
    }
  }, 30_000);

  it("rejects linked existing publication roots without following them", async () => {
    const { directory } = await scratch();
    const real = path.join(directory, "real-package");
    await mkdir(real);
    await writeFile(path.join(real, "game.json"), "original\n");
    const output = path.join(directory, "link-package");
    await symlink(real, output, process.platform === "win32" ? "junction" : "dir");
    await expect(
      publish(new Map([["game.json", "original\n"]]), output, path.join(directory, "unused"), true),
    ).rejects.toThrow("PACKAGE_LINK_UNSUPPORTED");
    expect(await readFile(path.join(real, "game.json"), "utf8")).toBe("original\n");
  });

  it.each([
    ["media/Image.png", "media/image.png"],
    ["media/caf\u00e9.png", "media/cafe\u0301.png"],
  ])(
    "rejects portable path aliases %s and %s",
    async (first, second) => {
      const { source } = await scratch();
      await writeFile(path.join(source, first), "image");
      await expect(
        readAuthoringMedia(source, {
          first: { kind: "image", path: first },
          second: { kind: "image", path: second },
        }),
      ).rejects.toThrow("path collision");
    },
    30_000,
  );

  it("rejects unsafe publication keys and pre-existing staging content without publishing", async () => {
    const { directory } = await scratch();
    const output = path.join(directory, "package/1.0.0");
    await expect(
      publish(new Map([["../outside.bin", "bad"]]), output, path.join(directory, "stage"), false),
    ).rejects.toThrow("PACKAGE_PATH_INVALID");
    const staleStage = path.join(directory, "stale-stage");
    await mkdir(staleStage);
    await writeFile(path.join(staleStage, "unvalidated.bin"), "stale");
    await expect(
      publish(new Map([["game.json", "{}\n"]]), output, staleStage, false),
    ).rejects.toMatchObject({ code: "EEXIST" });
    await expect(readFile(path.join(output, "game.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(path.join(staleStage, "unvalidated.bin"), "utf8")).toBe("stale");
  });
});

describe.skipIf(!process.env.LUBAN_ROOT)("real full-package media generation", () => {
  it("includes media in loader inventory and detects a source byte change after real export", async () => {
    const { directory, source } = await scratch();
    await cp(path.resolve("content-authoring/samples/full"), source, { recursive: true });
    const output = path.join(directory, "configuration-complete/0.1.0");
    const options = { source, output, lubanRoot: process.env.LUBAN_ROOT! };
    const built = await buildContent(options);
    const filename = Object.values(built.game.assets)[0]?.path;
    if (!filename) throw new Error("Full author sample must declare a real media asset");
    const bytes = await readFile(path.join(source, filename));
    expect(await readFile(path.join(output, filename))).toEqual(bytes);
    await buildContent({ ...options, check: true });
    await writeFile(path.join(source, filename), Buffer.concat([bytes, Buffer.from([0xff])]));
    await expect(buildContent({ ...options, check: true })).rejects.toThrow(
      `OUTPUT_DRIFT: ${filename}`,
    );
    expect(await readFile(path.join(output, filename))).toEqual(bytes);
  }, 240_000);
});
