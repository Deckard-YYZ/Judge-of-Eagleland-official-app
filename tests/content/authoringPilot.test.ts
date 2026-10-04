import { mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Tables } from "../../content-authoring/generated/schema5";
import { assemble5 } from "../../scripts/content/assemble5";
import { locateIssue } from "../../scripts/content/assemble";
import { buildContent } from "../../scripts/content/build";
import { loadSplitContentPackage } from "../../src/content/localizedPackageFormat";
import { CONFIGURATION_PILOT_GAME_CONTENT } from "../../src/app/configurationPilot";

describe.skipIf(!process.env.LUBAN_ROOT)("schema5 real XLSX authoring", () => {
  it("rebuilds exactly, preserves the schema4 model, and maps a broken table reference back to workbook coordinates", async () => {
    const root = path.resolve("artifacts/content-authoring/tests");
    await mkdir(root, { recursive: true });
    const scratch = await mkdtemp(path.join(root, "pilot-"));
    const source = path.resolve("content-authoring/samples/schema5");
    const output = path.join(scratch, "configuration-pilot/0.1.0");
    const options = { source, output, lubanRoot: process.env.LUBAN_ROOT! };
    const built = await buildContent(options);
    expect(built.game).toEqual(CONFIGURATION_PILOT_GAME_CONTENT);
    expect(await readdir(output)).toEqual(["game.json", "locales"]);
    expect(await readdir(path.join(output, "locales"))).toEqual(["en-US.json", "zh-CN.json"]);
    await buildContent({ ...options, check: true });
    await buildContent({
      source: path.resolve("content-authoring/samples/schema4"),
      output: path.resolve("content/configuration-skeleton/0.1.0"),
      lubanRoot: options.lubanRoot,
      check: true,
    });
    // Keep the author workbook untouched. These are actual Luban rows from the preceding XLSX export.
    const tables = new Tables((file) =>
      JSON.parse(readFileSync(path.join(built.staging, "data", `${file}.json`), "utf8")),
    );
    Reflect.set(tables.TbChoice.get("approve")!, "targetId", "missing_resolution");
    const assembled = assemble5(
      tables,
      JSON.parse(await readFile(path.join(source, "package.json"), "utf8")),
      JSON.parse(await readFile(path.join(source, "rules.json"), "utf8")),
    );
    const result = loadSplitContentPackage([
      { source: "game.json", text: JSON.stringify(assembled.game) },
      ...(await Promise.all(
        ["zh-CN", "en-US"].map(async (locale) => ({
          source: `locales/${locale}.json`,
          text: await readFile(path.join(source, `locales/${locale}.json`), "utf8"),
        })),
      )),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected invalid resolution reference.");
    const issue = result.issues.find((issue) => issue.code === "RESOLUTION_REFERENCE_INVALID")!;
    expect(locateIssue(issue, assembled.mappings)).toMatchObject({
      file: "Data/sample.xlsx",
      sheet: "choice",
      row: 6,
      column: "F",
      objectId: "approve",
      field: "targetId",
    });
    expect(JSON.parse(await readFile(path.join(output, "game.json"), "utf8"))).toEqual(
      CONFIGURATION_PILOT_GAME_CONTENT,
    );
  }, 120_000);
});
