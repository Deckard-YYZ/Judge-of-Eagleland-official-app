import { describe, expect, it } from "vitest";

import { MINIMAL_GAME_CONTENT } from "../../src/content/fixtures/minimalCatalog";
import type { GameContentCatalog } from "../../src/content/schema";
import {
  validateGameContentCatalog,
  type ContentValidationIssue,
  type ContentValidationIssueCode,
} from "../../src/content/validate";

const cloneCatalog = (): GameContentCatalog => structuredClone(MINIMAL_GAME_CONTENT);

const invalidIssues = (catalog: GameContentCatalog): readonly ContentValidationIssue[] => {
  const result = validateGameContentCatalog(catalog);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected graph validation to fail.");
  }
  return result.issues;
};

const summarize = (issues: readonly ContentValidationIssue[]) =>
  issues.map(({ code, objectId, path }) => ({ code, objectId, path }));

const expectIssueSummary = (
  catalog: GameContentCatalog,
  expected: readonly {
    readonly code: ContentValidationIssueCode;
    readonly objectId: string;
    readonly path: readonly (string | number)[];
  }[],
): void => {
  expect(summarize(invalidIssues(catalog))).toEqual(expected);
};

describe("case graph validation", () => {
  it("accepts the existing valid graph and ignores unused resolutions and assets", () => {
    const catalog = cloneCatalog();
    catalog.cases.case_001.resolutions.unused = structuredClone(
      catalog.cases.case_001.resolutions.warning,
    );
    catalog.assets.unused_image = {
      kind: "image",
      path: "media/images/unused.png",
    };

    expect(validateGameContentCatalog(catalog)).toMatchObject({ ok: true, issues: [] });
  });

  it("allows diamond branches to converge on a previously visited node", () => {
    const catalog = cloneCatalog();
    const definition = catalog.cases.case_001;
    definition.startNodeId = "start";
    definition.nodes = {
      start: {
        choices: [
          {
            id: "choose_left",
            hasAnnotation: false,
            target: { type: "node", nodeId: "left" },
          },
          {
            id: "choose_right",
            hasAnnotation: false,
            target: { type: "node", nodeId: "right" },
          },
        ],
      },
      left: {
        choices: [
          {
            id: "left_to_merge",
            hasAnnotation: false,
            target: { type: "node", nodeId: "merge" },
          },
        ],
      },
      right: {
        choices: [
          {
            id: "right_to_merge",
            hasAnnotation: false,
            target: { type: "node", nodeId: "merge" },
          },
        ],
      },
      merge: {
        choices: [
          {
            id: "finish_after_merge",
            hasAnnotation: false,
            target: { type: "resolution", resolutionId: "close_with_note" },
          },
        ],
      },
    };

    expect(validateGameContentCatalog(catalog)).toMatchObject({ ok: true, issues: [] });
  });

  it("detects a reachable self-cycle and explains the non-terminating path", () => {
    const catalog = cloneCatalog();
    const definition = catalog.cases.case_001;
    definition.nodes = {
      assessment: {
        choices: [
          {
            id: "loop_here",
            hasAnnotation: false,
            target: { type: "node", nodeId: "assessment" },
          },
          {
            id: "exit_loop",
            hasAnnotation: false,
            target: { type: "resolution", resolutionId: "close_with_note" },
          },
        ],
      },
    };

    const issues = invalidIssues(catalog);
    expect(summarize(issues)).toEqual([
      {
        code: "CASE_GRAPH_CYCLE",
        objectId: "case_001",
        path: ["cases", "case_001", "nodes", "assessment", "choices", 0, "target", "nodeId"],
      },
      {
        code: "CASE_PATH_NON_TERMINATING",
        objectId: "case_001",
        path: ["cases", "case_001", "nodes", "assessment", "choices", 0, "target", "nodeId"],
      },
    ]);
    expect(issues[1].message).toContain("indefinitely instead of reaching a resolution");
  });

  it("detects a reachable cycle spanning multiple nodes", () => {
    const catalog = cloneCatalog();
    const definition = catalog.cases.case_001;
    definition.startNodeId = "start";
    definition.nodes = {
      start: {
        choices: [
          {
            id: "start_cycle",
            hasAnnotation: false,
            target: { type: "node", nodeId: "alpha" },
          },
        ],
      },
      alpha: {
        choices: [
          {
            id: "alpha_beta",
            hasAnnotation: false,
            target: { type: "node", nodeId: "beta" },
          },
        ],
      },
      beta: {
        choices: [
          {
            id: "beta_alpha",
            hasAnnotation: false,
            target: { type: "node", nodeId: "alpha" },
          },
          {
            id: "beta_exit",
            hasAnnotation: false,
            target: { type: "resolution", resolutionId: "warning" },
          },
        ],
      },
    };

    expectIssueSummary(catalog, [
      {
        code: "CASE_GRAPH_CYCLE",
        objectId: "case_001",
        path: ["cases", "case_001", "nodes", "beta", "choices", 0, "target", "nodeId"],
      },
      {
        code: "CASE_PATH_NON_TERMINATING",
        objectId: "case_001",
        path: ["cases", "case_001", "nodes", "beta", "choices", 0, "target", "nodeId"],
      },
    ]);
  });

  it("reports every published node that is unreachable from the start", () => {
    const catalog = cloneCatalog();
    catalog.cases.case_001.nodes.orphan = {
      choices: [
        {
          id: "orphan_finish",
          hasAnnotation: false,
          target: { type: "resolution", resolutionId: "warning" },
        },
      ],
    };

    expectIssueSummary(catalog, [
      {
        code: "CASE_NODE_UNREACHABLE",
        objectId: "case_001",
        path: ["cases", "case_001", "nodes", "orphan"],
      },
    ]);
  });

  it("detects cycles in unreachable published nodes without claiming a playable nontermination", () => {
    const catalog = cloneCatalog();
    catalog.cases.case_001.nodes.orphan_a = {
      choices: [
        {
          id: "orphan_a_to_b",
          hasAnnotation: false,
          target: { type: "node", nodeId: "orphan_b" },
        },
      ],
    };
    catalog.cases.case_001.nodes.orphan_b = {
      choices: [
        {
          id: "orphan_b_to_a",
          hasAnnotation: false,
          target: { type: "node", nodeId: "orphan_a" },
        },
      ],
    };

    expectIssueSummary(catalog, [
      {
        code: "CASE_NODE_UNREACHABLE",
        objectId: "case_001",
        path: ["cases", "case_001", "nodes", "orphan_a"],
      },
      {
        code: "CASE_NODE_UNREACHABLE",
        objectId: "case_001",
        path: ["cases", "case_001", "nodes", "orphan_b"],
      },
      {
        code: "CASE_GRAPH_CYCLE",
        objectId: "case_001",
        path: ["cases", "case_001", "nodes", "orphan_b", "choices", 0, "target", "nodeId"],
      },
    ]);
  });

  it("lets C1 own missing references without graph-error cascades", () => {
    const catalog = cloneCatalog();
    catalog.cases.case_001.nodes.assessment.choices[0].target = {
      type: "resolution",
      resolutionId: "missing_resolution",
    };
    catalog.cases.case_001.nodes.assessment.choices[1].target = {
      type: "node",
      nodeId: "missing_node",
    };

    expectIssueSummary(catalog, [
      {
        code: "RESOLUTION_REFERENCE_INVALID",
        objectId: "case_001",
        path: ["cases", "case_001", "nodes", "assessment", "choices", 0, "target", "resolutionId"],
      },
      {
        code: "NODE_REFERENCE_INVALID",
        objectId: "case_001",
        path: ["cases", "case_001", "nodes", "assessment", "choices", 1, "target", "nodeId"],
      },
    ]);
  });
});
