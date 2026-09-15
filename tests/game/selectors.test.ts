import { describe, expect, it } from "vitest";
import { MINIMAL_CATALOG } from "../../src/content/fixtures/minimalCatalog";
import type { GameState } from "../../src/game/model";
import { selectPendingAndActiveCases, selectResolvedCases } from "../../src/game/selectors";

const resolved = (resolvedOrder: number) => ({
  status: "resolved" as const,
  history: [],
  resolutionId: "result",
  snapshot: {
    caseTitle: "Case",
    finalChoiceText: "Choice",
    verdict: [{ type: "paragraph" as const, text: "Verdict" }],
    result: [{ type: "paragraph" as const, text: "Result" }],
    attributeChanges: [],
    resolvedAt: "2026-09-15T00:00:00.000Z",
    resolvedOrder,
  },
});

const stateWithCases = (cases: GameState["cases"]): GameState => ({
  phase: { type: "playing" },
  attributes: { restraint: 50, authority: 50 },
  flags: { first_case_closed: false, second_case_reviewed: false },
  cases,
  pendingStoryIds: [],
  completedStoryIds: [],
});

describe("case list selectors", () => {
  it("keeps pending and active together in content order without showing locked cases", () => {
    const mixed = stateWithCases({
      case_002: { status: "pending" },
      case_001: { status: "active", currentNodeId: "assessment", history: [] },
    });
    expect(selectPendingAndActiveCases(mixed, MINIMAL_CATALOG).map((item) => item.caseId)).toEqual([
      "case_001",
      "case_002",
    ]);

    const caseTwoLocked = stateWithCases({ case_001: { status: "pending" } });
    expect(
      selectPendingAndActiveCases(caseTwoLocked, MINIMAL_CATALOG).map((item) => item.caseId),
    ).toEqual(["case_001"]);
  });

  it("sorts resolved cases newest first and excludes them from the active list", () => {
    const state = stateWithCases({ case_001: resolved(1), case_002: resolved(2) });

    expect(selectResolvedCases(state, MINIMAL_CATALOG).map((item) => item.caseId)).toEqual([
      "case_002",
      "case_001",
    ]);
    expect(selectPendingAndActiveCases(state, MINIMAL_CATALOG)).toEqual([]);
  });

  it("uses stable ID ordering for equal authored order and equal resolved order", () => {
    const content = structuredClone(MINIMAL_CATALOG);
    content.cases.case_001.order = 10;
    content.cases.case_002.order = 10;

    const open = stateWithCases({
      case_002: { status: "pending" },
      case_001: { status: "pending" },
    });
    expect(selectPendingAndActiveCases(open, content).map((item) => item.caseId)).toEqual([
      "case_001",
      "case_002",
    ]);

    const closed = stateWithCases({ case_002: resolved(1), case_001: resolved(1) });
    expect(selectResolvedCases(closed, content).map((item) => item.caseId)).toEqual([
      "case_001",
      "case_002",
    ]);
  });

  it("does not mutate inputs and defensively skips state cases missing from content", () => {
    const content = structuredClone(MINIMAL_CATALOG);
    const state = stateWithCases({
      missing_case: { status: "pending" },
      case_001: { status: "pending" },
    });
    const beforeState = structuredClone(state);
    const beforeContent = structuredClone(content);

    expect(selectPendingAndActiveCases(state, content).map((item) => item.caseId)).toEqual([
      "case_001",
    ]);
    expect(selectResolvedCases(state, content)).toEqual([]);
    expect(state).toEqual(beforeState);
    expect(content).toEqual(beforeContent);
  });
});
