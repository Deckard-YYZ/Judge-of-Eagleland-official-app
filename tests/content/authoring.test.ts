import { mkdir, mkdtemp, readFile, writeFile, cp, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildContent, publish } from "../../scripts/content/build";
import { loadSplitContentPackage } from "../../src/content/localizedPackageFormat";
import { createInitialGameState } from "../../src/game/initialization";
import { transition } from "../../src/game/transition";

const sample = path.resolve("content-authoring/samples/schema4");
const packageDirectory = path.resolve("content/configuration-skeleton/0.1.0");
async function scratch() {
  const directory = path.resolve("artifacts/content-authoring/tests");
  await mkdir(directory, { recursive: true });
  return mkdtemp(path.join(directory, "test-"));
}

describe("authoring publication contract", () => {
  it("loads the generated physical package and applies its authored choice effect in Game Core", async () => {
    const sources = await Promise.all(
      ["game.json", "locales/zh-CN.json"].map(async (source) => ({
        source,
        text: await readFile(path.join(packageDirectory, source), "utf8"),
      })),
    );
    const loaded = loadSplitContentPackage(sources, {
      fileInventory: sources.map((entry) => entry.source),
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues));
    const initial = createInitialGameState(loaded.gameContent);
    if (!initial.ok) throw new Error(JSON.stringify(initial.issues));
    const context = { nowIso: "2026-10-04T00:00:00.000Z" };
    const started = transition(
      initial.state,
      { type: "startCase", caseId: "sample_case" },
      loaded.gameContent,
      context,
    );
    if (!started.ok) throw new Error(started.message);
    const chosen = transition(
      started.nextState,
      { type: "chooseOption", caseId: "sample_case", nodeId: "opening", choiceId: "approve" },
      loaded.gameContent,
      context,
    );
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) throw new Error(chosen.message);
    expect(chosen.nextState.attributes.restraint).toBe(55);
    expect(chosen.nextState.cases.sample_case.status).toBe("resolved");
  });

  it("checks exact output and refuses changed or missing versions without damaging existing bytes", async () => {
    const directory = await scratch();
    const output = path.join(directory, "sample/0.1.0");
    const files = new Map([["game.json", "original\n"]]);
    await expect(publish(files, output, path.join(directory, "unused"), true)).rejects.toThrow(
      "OUTPUT_MISSING",
    );
    await publish(files, output, path.join(directory, "stage"), false);
    await publish(files, output, path.join(directory, "unused"), true);
    await expect(
      publish(new Map([["game.json", "changed\n"]]), output, path.join(directory, "unused"), false),
    ).rejects.toThrow("OUTPUT_DRIFT");
    expect(await readFile(path.join(output, "game.json"), "utf8")).toBe("original\n");
    expect(await readdir(output)).toEqual(["game.json"]);
  }, 60_000);
});

// Explicit opt-in keeps the runtime suite independent of .NET. CI authoring jobs set LUBAN_ROOT.
describe.skipIf(!process.env.LUBAN_ROOT)("pinned Luban integration", () => {
  it("exports actual tables, detects drift, and reports broken references without publishing", async () => {
    const directory = await scratch();
    const source = path.join(directory, "source");
    await cp(sample, source, { recursive: true });
    const output = path.join(directory, "configuration-skeleton/0.1.0");
    const options = { source, output, lubanRoot: process.env.LUBAN_ROOT! };
    await buildContent(options);
    const before = await readFile(path.join(output, "game.json"), "utf8");
    await buildContent({ ...options, check: true });
    const effects = path.join(source, "Data/effect.csv");
    await writeFile(
      effects,
      (await readFile(effects, "utf8")).replace("restraint,5,false", "restraint,6,false"),
    );
    await expect(buildContent({ ...options, check: true })).rejects.toThrow("OUTPUT_DRIFT");
    const choices = path.join(source, "Data/choice.csv");
    await writeFile(
      choices,
      (await readFile(choices, "utf8")).replace("Resolution,approved", "Resolution,missing"),
    );
    await expect(buildContent(options)).rejects.toThrow(
      /Data\/choice\.csv.*object=approve.*field=targetId/,
    );
    expect(await readFile(path.join(output, "game.json"), "utf8")).toBe(before);
    const newOutput = path.join(directory, "unpublished/configuration-skeleton/0.1.0");
    await expect(buildContent({ ...options, output: newOutput })).rejects.toThrow(
      /Data\/choice\.csv/,
    );
    await expect(readFile(path.join(newOutput, "game.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }, 120_000);
});
