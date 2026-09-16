import { describe, expect, it } from "vitest";
import type { GameContentCatalog } from "../../src/content/schema";
import { MINIMAL_GAME_CONTENT } from "../../src/content/fixtures/minimalCatalog";
import { createInitialGameState } from "../../src/game/initialization";

const catalogCopy = (): GameContentCatalog => structuredClone(MINIMAL_GAME_CONTENT);

describe("createInitialGameState", () => {
  it("creates a playing state from the catalog initial definition", () => {
    const catalog = catalogCopy();
    catalog.initial.storyIds = ["story_after_case_001"];

    const result = createInitialGameState(catalog);

    expect(result).toEqual({
      ok: true,
      state: {
        phase: { type: "playing" },
        attributes: { restraint: 50, authority: 50 },
        flags: { first_case_closed: false, second_case_reviewed: false },
        cases: { case_001: { status: "pending" } },
        pendingStoryIds: ["story_after_case_001"],
        completedStoryIds: [],
        storyCheckpoint: null,
      },
    });
  });

  it("does not share mutable state containers with content or another new run", () => {
    const catalog = catalogCopy();
    catalog.initial.storyIds = ["story_after_case_001"];
    const first = createInitialGameState(catalog);
    const second = createInitialGameState(catalog);

    if (!first.ok || !second.ok) {
      throw new Error("The valid fixture should create initial states.");
    }

    first.state.attributes.restraint = 0;
    first.state.flags.first_case_closed = true;
    first.state.cases.case_001 = { status: "active", currentNodeId: "assessment", history: [] };
    first.state.pendingStoryIds.push("ending_fallback");

    expect(catalog.attributes.restraint.initial).toBe(50);
    expect(catalog.initial.flags.first_case_closed).toBe(false);
    expect(catalog.initial.caseIds).toEqual(["case_001"]);
    expect(catalog.initial.storyIds).toEqual(["story_after_case_001"]);
    expect(second.state).toEqual({
      phase: { type: "playing" },
      attributes: { restraint: 50, authority: 50 },
      flags: { first_case_closed: false, second_case_reviewed: false },
      cases: { case_001: { status: "pending" } },
      pendingStoryIds: ["story_after_case_001"],
      completedStoryIds: [],
      storyCheckpoint: null,
    });
  });

  it("reports every unknown and duplicate initial case or story ID", () => {
    const catalog = catalogCopy();
    catalog.initial.caseIds = ["case_001", "missing_case", "case_001"];
    catalog.initial.storyIds = ["story_after_case_001", "missing_story", "story_after_case_001"];

    const result = createInitialGameState(catalog);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Invalid initial references should be rejected.");
    }

    expect(result.issues).toEqual([
      {
        code: "INITIAL_CASE_UNKNOWN",
        path: ["initial", "caseIds", 1],
        message: 'Initial case ID "missing_case" does not exist in the content catalog.',
      },
      {
        code: "INITIAL_CASE_DUPLICATE",
        path: ["initial", "caseIds", 2],
        message: 'Initial case ID "case_001" is duplicated.',
      },
      {
        code: "INITIAL_STORY_UNKNOWN",
        path: ["initial", "storyIds", 1],
        message: 'Initial story ID "missing_story" does not exist in the content catalog.',
      },
      {
        code: "INITIAL_STORY_DUPLICATE",
        path: ["initial", "storyIds", 2],
        message: 'Initial story ID "story_after_case_001" is duplicated.',
      },
    ]);
  });
});
