import { describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Tables } from "../../content-authoring/generated/schema5";
import { assemble5 } from "../../scripts/content/assemble5";
import { locateIssue } from "../../scripts/content/assemble";
import { buildContent } from "../../scripts/content/build";
import { validateGameContentCatalog } from "../../src/content/validate";
import { COMPLETE_GAME } from "../fixtures/configurationComplete";

describe.skipIf(!process.env.LUBAN_ROOT)("complete authoring tables and structured flow", () => {
  it("exports XLSX and media, checks legacy authors, maps new tables/JSON, and rejects actual structured-source drift without publishing", async () => {
    const root = path.resolve("artifacts/content-authoring/tests");
    await mkdir(root, { recursive: true });
    const scratch = await mkdtemp(path.join(root, "complete-"));
    const source = path.resolve("content-authoring/samples/full");
    const output = path.join(scratch, "configuration-complete/0.1.0");
    const options = { source, output, lubanRoot: process.env.LUBAN_ROOT! };
    const built = await buildContent(options);
    expect(built.game).toEqual(COMPLETE_GAME);
    expect(await readdir(output)).toEqual(["game.json", "locales", "media"]);
    for (const asset of Object.values(built.game.assets))
      expect(await readFile(path.join(output, asset.path))).toEqual(
        await readFile(path.join(source, asset.path)),
      );
    await buildContent({ ...options, check: true });
    for (const [author, id] of [
      ["schema4", "configuration-skeleton"],
      ["schema5", "configuration-pilot"],
    ]) {
      await buildContent({
        source: path.resolve(`content-authoring/samples/${author}`),
        output: path.resolve(`content/${id}/0.1.0`),
        lubanRoot: options.lubanRoot,
        check: true,
      });
    }
    const manifest = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
    const rules = JSON.parse(await readFile(path.join(source, "rules.json"), "utf8"));
    const tables = () =>
      new Tables((file) =>
        JSON.parse(readFileSync(path.join(built.staging, "data", `${file}.json`), "utf8")),
      );
    for (const [table, key, field, expected] of [
      ["TbAsset", "portrait", "path", { sheet: "asset", row: 4, column: "D", field: "path" }],
      [
        "TbCharacter",
        "clerk",
        "portraitAssetId",
        { sheet: "character", row: 4, column: "C", field: "portraitAssetId" },
      ],
    ] as const) {
      const broken = tables();
      Reflect.set(
        broken[table].get(key)!,
        field,
        field === "path" ? "../portrait.png" : "constructor",
      );
      const assembled = assemble5(broken, manifest, rules);
      const result = validateGameContentCatalog(assembled.game, { source: "game.json" });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected table reference diagnostics.");
      const issue = result.issues.find((issue) => issue.path.at(-1) === field)!;
      expect(locateIssue(issue, assembled.mappings)).toMatchObject({
        file: "Data/sample.xlsx",
        ...expected,
      });
    }
    const wrongOwner = tables();
    Reflect.set(wrongOwner.TbCaseCharacter.get("intake_clerk")!, "caseId", "toString");
    expect(() => assemble5(wrongOwner, manifest, rules)).toThrow(/caseCharacter!C4.*Unknown case/);
    const sourceCopy = path.join(scratch, "source");
    await cp(source, sourceCopy, { recursive: true });
    const brokenRules = structuredClone(rules);
    brokenRules.flow.chats.clerk_intro.nodes.greeting.externalBranches[0].targetNodeId =
      "constructor";
    await writeFile(path.join(sourceCopy, "rules.json"), JSON.stringify(brokenRules));
    const unpublished = path.join(scratch, "failure/configuration-complete/0.1.0");
    await expect(
      buildContent({ ...options, source: sourceCopy, output: unpublished }),
    ).rejects.toThrow(
      /rules.json.*flow.chats.clerk_intro.nodes.greeting.externalBranches.0.targetNodeId/,
    );
    await expect(readdir(unpublished)).rejects.toThrow();
    expect(JSON.parse(await readFile(path.join(output, "game.json"), "utf8"))).toEqual(
      COMPLETE_GAME,
    );
    // A valid authored change must be visible to check, rather than silently omitted.
    const changedRules = structuredClone(rules);
    changedRules.flow.stages.registration.transitions[0].when.all.push({
      type: "flagEquals",
      flagId: "judged",
      value: true,
    });
    await writeFile(path.join(sourceCopy, "rules.json"), JSON.stringify(changedRules));
    await expect(buildContent({ ...options, source: sourceCopy, check: true })).rejects.toThrow(
      /OUTPUT_DRIFT/,
    );
    expect(JSON.parse(await readFile(path.join(output, "game.json"), "utf8"))).toEqual(
      COMPLETE_GAME,
    );
  }, 300_000);
});
