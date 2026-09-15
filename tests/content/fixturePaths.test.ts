// @ts-expect-error Node typings are intentionally absent from the browser production tsconfig.
import { readdir, readFile } from "node:fs/promises";
// @ts-expect-error Node typings are intentionally absent from the browser production tsconfig.
import path from "node:path";
// @ts-expect-error Node typings are intentionally absent from the browser production tsconfig.
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadContentPackage, type ContentPackageSource } from "../../src/content/packageFormat";
import type { ContentCatalog } from "../../src/content/schema";
import type { GameCommand, TransitionResult } from "../../src/game/commands";
import { createInitialGameState } from "../../src/game/initialization";
import type { GameState } from "../../src/game/model";
import { transition } from "../../src/game/transition";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PACKAGE_DIRECTORY = path.join(REPOSITORY_ROOT, "content", "validator-fixture", "1.0.0");

const collectFiles = async (directory: string): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(filename)));
    } else if (entry.isFile()) {
      files.push(filename);
    }
  }
  return files.sort();
};

const loadFixtureCatalog = async (): Promise<Readonly<ContentCatalog>> => {
  const files = await collectFiles(PACKAGE_DIRECTORY);
  const sourceFor = (filename: string) =>
    path.relative(PACKAGE_DIRECTORY, filename).split(path.sep).join("/");
  const sources: ContentPackageSource[] = [];
  for (const filename of files.filter((candidate) => candidate.endsWith(".json"))) {
    sources.push({ source: sourceFor(filename), text: await readFile(filename, "utf8") });
  }

  const result = loadContentPackage(sources, {
    fileInventory: files.map(sourceFor),
    expectedPackageId: "validator-fixture",
    expectedVersion: "1.0.0",
  });
  if (!result.ok) {
    throw new Error(`Fixture package is invalid: ${JSON.stringify(result.issues)}`);
  }
  return result.catalog;
};

const stateOf = (result: TransitionResult): GameState => {
  if (!result.ok) {
    throw new Error(`Expected transition success, received ${result.code}: ${result.message}`);
  }
  return result.nextState;
};

interface CaseChoice {
  readonly caseId: "case_001" | "case_002" | "case_003";
  readonly choiceId: string;
  readonly authorityDelta: number;
}

const CHOICES: readonly (readonly CaseChoice[])[] = [
  [
    { caseId: "case_001", choiceId: "publish_now", authorityDelta: 4 },
    { caseId: "case_001", choiceId: "allow_delay", authorityDelta: -4 },
  ],
  [
    { caseId: "case_002", choiceId: "deny_passage", authorityDelta: 3 },
    { caseId: "case_002", choiceId: "grant_passage", authorityDelta: -3 },
  ],
  [
    { caseId: "case_003", choiceId: "full_report", authorityDelta: 2 },
    { caseId: "case_003", choiceId: "redacted_report", authorityDelta: -2 },
  ],
];

const ALL_PATHS = CHOICES[0].flatMap((first) =>
  CHOICES[1].flatMap((second) => CHOICES[2].map((third) => [first, second, third] as const)),
);

const playPath = (content: Readonly<ContentCatalog>, choices: readonly CaseChoice[]): GameState => {
  const initialized = createInitialGameState(content);
  if (!initialized.ok) {
    throw new Error(`Cannot initialize fixture: ${JSON.stringify(initialized.issues)}`);
  }
  let state = initialized.state;
  const run = (command: GameCommand, turn: number) =>
    transition(state, command, content, {
      nowIso: `2026-09-15T10:00:0${turn}.000Z`,
    });

  choices.forEach((choice, index) => {
    state = stateOf(run({ type: "startCase", caseId: choice.caseId }, index * 2));
    state = stateOf(
      run(
        {
          type: "chooseOption",
          caseId: choice.caseId,
          nodeId: "decision",
          choiceId: choice.choiceId,
        },
        index * 2 + 1,
      ),
    );

    // Ordinary story is a real blocking queue item; drain it before attempting the next case.
    if (index < choices.length - 1) {
      while (state.pendingStoryIds.length > 0) {
        state = stateOf(
          run({ type: "completeStory", storyId: state.pendingStoryIds[0] }, index * 2 + 1),
        );
      }
    }
  });
  return state;
};

describe("three-case content fixture paths", () => {
  it("loads the physical package with exactly three DAG cases and the video fallback", async () => {
    const content = await loadFixtureCatalog();

    expect(Object.keys(content.cases).sort()).toEqual(["case_001", "case_002", "case_003"]);
    expect(content.stories.ending_high_authority.steps[0]).toMatchObject({
      type: "video",
      assetId: "ending_video",
      fallbackBlocks: [expect.objectContaining({ type: "paragraph" })],
    });
  });

  it.each(ALL_PATHS)(
    "plays choices %# through the formal Game Core to an ending",
    async (...choices) => {
      const content = await loadFixtureCatalog();
      const endingState = playPath(content, choices);
      const expectedAuthority =
        50 + choices.reduce((sum, choice) => sum + choice.authorityDelta, 0);
      const expectedEnding = expectedAuthority >= 50 ? "high_authority" : "measured";

      expect(endingState.attributes.authority).toBe(expectedAuthority);
      expect(endingState.phase).toEqual({ type: "ending", endingId: expectedEnding });
      expect(endingState.pendingStoryIds).toEqual([
        expectedEnding === "high_authority" ? "ending_high_authority" : "ending_measured",
      ]);
      expect(
        Object.values(endingState.cases).every((progress) => progress.status === "resolved"),
      ).toBe(true);

      const completed = stateOf(
        transition(
          endingState,
          { type: "completeStory", storyId: endingState.pendingStoryIds[0] },
          content,
          { nowIso: "2026-09-15T11:00:00.000Z" },
        ),
      );
      expect(completed.phase).toEqual({ type: "ended", endingId: expectedEnding });
    },
  );
});
