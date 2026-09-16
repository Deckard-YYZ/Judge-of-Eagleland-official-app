import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  loadSplitContentPackage,
  type ContentPackageSource,
} from "../../src/content/localizedPackageFormat";
import type { GameContentCatalog } from "../../src/content/schema";
import type { TransitionResult } from "../../src/game/commands";
import { createInitialGameState } from "../../src/game/initialization";
import type { GameState } from "../../src/game/model";
import { transition } from "../../src/game/transition";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PACKAGE_DIRECTORY = path.join(REPOSITORY_ROOT, "content", "minimal-test-package", "1.0.0");

const collectFiles = async (directory: string): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(filename)));
    else if (entry.isFile()) files.push(filename);
  }
  return files.sort();
};

const loadFixture = async () => {
  const files = await collectFiles(PACKAGE_DIRECTORY);
  const sourceFor = (filename: string) =>
    path.relative(PACKAGE_DIRECTORY, filename).split(path.sep).join("/");
  const sources: ContentPackageSource[] = [];
  for (const filename of files.filter((candidate) => candidate.endsWith(".json"))) {
    sources.push({ source: sourceFor(filename), text: await readFile(filename, "utf8") });
  }
  const result = loadSplitContentPackage(sources, {
    fileInventory: files.map(sourceFor),
    expectedPackageId: "minimal-test-package",
    expectedVersion: "1.0.0",
  });
  if (!result.ok) throw new Error(`Fixture invalid: ${JSON.stringify(result.issues)}`);
  return result;
};

const stateOf = (result: TransitionResult): GameState => {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.nextState;
};

const runCompletePath = (content: Readonly<GameContentCatalog>): GameState => {
  const initialized = createInitialGameState(content);
  if (!initialized.ok) throw new Error(JSON.stringify(initialized.issues));
  let state = initialized.state;
  let turn = 0;
  const run = (command: Parameters<typeof transition>[1]) => {
    state = stateOf(
      transition(state, command, content, {
        nowIso: `2026-09-15T10:00:${String(turn++).padStart(2, "0")}.000Z`,
      }),
    );
  };

  run({ type: "startCase", caseId: "case_001" });
  run({
    type: "chooseOption",
    caseId: "case_001",
    nodeId: "assessment",
    choiceId: "confirm_violation",
  });
  run({
    type: "chooseOption",
    caseId: "case_001",
    nodeId: "disposition",
    choiceId: "formal_warning",
  });
  while (state.pendingStoryIds.length > 0) {
    run({ type: "completeStory", storyId: state.pendingStoryIds[0] });
  }
  run({ type: "startCase", caseId: "case_002" });
  run({
    type: "chooseOption",
    caseId: "case_002",
    nodeId: "assessment",
    choiceId: "request_review",
  });
  return state;
};

describe("schema-v2 physical content fixture", () => {
  it("loads one rules graph and complete Chinese/English language packs", async () => {
    const loaded = await loadFixture();
    expect(Object.keys(loaded.gameContent.cases)).toEqual(["case_001", "case_002"]);
    expect(loaded.localizations["zh-CN"].cases.case_001.title).toContain("夜间档案室");
    expect(loaded.localizations["en-US"].cases.case_001.title).toContain("Night Archive");
    expect(loaded.gameContent.stories.ending_balanced.steps[0]).toMatchObject({
      id: "closing_video",
      type: "video",
      assetId: "ending_balanced_video",
    });
  });

  it("plays the physical rules package through Game Core without localized data", async () => {
    const loaded = await loadFixture();
    const state = runCompletePath(loaded.gameContent);
    expect(state.phase).toEqual({ type: "ending", endingId: "balanced" });
    expect(state.attributes).toEqual({ restraint: 56, authority: 51 });
    expect(JSON.stringify(state)).not.toMatch(/夜间档案室|Night Archive|书面警告|written warning/u);
  });
});
