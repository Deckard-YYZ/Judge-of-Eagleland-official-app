import { describe, expect, it } from "vitest";

import { MINIMAL_GAME_CONTENT } from "../../src/content/fixtures/minimalCatalog";
import type { GameContentCatalog } from "../../src/content/schema";
import {
  validateGameContentCatalog,
  type ContentValidationIssue,
  type ContentValidationIssueCode,
} from "../../src/content/validate";

const cloneCatalog = (): GameContentCatalog => structuredClone(MINIMAL_GAME_CONTENT);

const invalidIssues = (input: unknown): readonly ContentValidationIssue[] => {
  const result = validateGameContentCatalog(input, { source: "fixture.json" });
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected content validation to fail.");
  }
  return result.issues;
};

const issueSummary = (issues: readonly ContentValidationIssue[]) =>
  issues.map(({ code, objectId, path }) => ({ code, objectId, path }));

interface ExpectedIssue {
  readonly code: ContentValidationIssueCode;
  readonly objectId: string;
  readonly path: readonly (string | number)[];
}

const expectSemanticIssues = (
  mutate: (catalog: GameContentCatalog) => void,
  expected: readonly ExpectedIssue[],
): void => {
  const catalog = cloneCatalog();
  mutate(catalog);
  expect(issueSummary(invalidIssues(catalog))).toEqual(expected);
};

describe("validateGameContentCatalog", () => {
  it("returns a discriminated success without mutating valid content", () => {
    const catalog = cloneCatalog();
    const before = structuredClone(catalog);

    const result = validateGameContentCatalog(catalog, { source: "valid.json" });

    expect(result).toMatchObject({ ok: true, issues: [] });
    expect(catalog).toEqual(before);
    if (result.ok) {
      expect(result.catalog.manifest.packageId).toBe("minimal-test-package");
    }
  });

  it("maps Zod failures into the stable public diagnostic shape", () => {
    const catalog = cloneCatalog();
    catalog.cases.case_001.nodes.assessment.choices[0].id = "";

    const issues = invalidIssues(catalog);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "GAME_CONTENT_SCHEMA_INVALID",
      source: "fixture.json",
      objectId: "case_001",
      path: ["cases", "case_001", "nodes", "assessment", "choices", 0, "id"],
    });
    expect(issues[0].message.length).toBeGreaterThan(0);
    expect(Object.keys(issues[0])).toEqual(["code", "source", "objectId", "path", "message"]);
  });

  it("safely reports structural parsing that throws before Zod can return issues", () => {
    const hostileInput = Object.defineProperty({}, "manifest", {
      enumerable: true,
      get: () => {
        throw new Error("hostile getter");
      },
    });

    expect(() => validateGameContentCatalog(hostileInput)).not.toThrow();
    expect(validateGameContentCatalog(hostileInput)).toEqual({
      ok: false,
      issues: [
        {
          code: "GAME_CONTENT_SCHEMA_INVALID",
          source: "<game-content>",
          objectId: "catalog",
          path: [],
          message: "Game content schema validation failed unexpectedly.",
        },
      ],
    });
  });

  it("returns diagnostics in a stable path-first order", () => {
    const catalog = cloneCatalog();
    catalog.initial.caseIds = ["missing_case"];
    catalog.cases.case_002.id = "wrong_002";
    catalog.cases.case_001.id = "wrong_001";

    const first = invalidIssues(catalog);
    const second = invalidIssues(catalog);

    expect(first).toEqual(second);
    expect(first.map((issue) => issue.path)).toEqual([
      ["cases", "case_001", "id"],
      ["cases", "case_002", "id"],
      ["initial", "caseIds", 0],
    ]);
  });

  it("checks case identity and case-scoped choice identity", () => {
    expectSemanticIssues(
      (catalog) => {
        catalog.cases.case_001.id = "wrong_case_id";
        catalog.cases.case_001.nodes.disposition.choices[0].id =
          catalog.cases.case_001.nodes.assessment.choices[0].id;
      },
      [
        {
          code: "CASE_KEY_ID_MISMATCH",
          objectId: "case_001",
          path: ["cases", "case_001", "id"],
        },
        {
          code: "CHOICE_ID_DUPLICATE",
          objectId: "case_001",
          path: ["cases", "case_001", "nodes", "disposition", "choices", 0, "id"],
        },
      ],
    );
  });

  it("checks initial references and reports every duplicate after its first occurrence", () => {
    expectSemanticIssues(
      (catalog) => {
        catalog.initial.caseIds = ["case_001", "missing_case", "case_001"];
        catalog.initial.storyIds = [
          "story_after_case_001",
          "missing_story",
          "story_after_case_001",
        ];
      },
      [
        {
          code: "CASE_REFERENCE_INVALID",
          objectId: "initial",
          path: ["initial", "caseIds", 1],
        },
        {
          code: "INITIAL_CASE_ID_DUPLICATE",
          objectId: "initial",
          path: ["initial", "caseIds", 2],
        },
        {
          code: "STORY_REFERENCE_INVALID",
          objectId: "initial",
          path: ["initial", "storyIds", 1],
        },
        {
          code: "INITIAL_STORY_ID_DUPLICATE",
          objectId: "initial",
          path: ["initial", "storyIds", 2],
        },
      ],
    );
  });

  it("checks case start and every choice target within its owning case", () => {
    expectSemanticIssues(
      (catalog) => {
        const definition = catalog.cases.case_001;
        definition.startNodeId = "missing_start";
        definition.nodes.assessment.choices[0].target = {
          type: "resolution",
          resolutionId: "missing_resolution",
        };
        definition.nodes.assessment.choices[1].target = {
          type: "node",
          nodeId: "missing_node",
        };
      },
      [
        {
          code: "RESOLUTION_REFERENCE_INVALID",
          objectId: "case_001",
          path: [
            "cases",
            "case_001",
            "nodes",
            "assessment",
            "choices",
            0,
            "target",
            "resolutionId",
          ],
        },
        {
          code: "NODE_REFERENCE_INVALID",
          objectId: "case_001",
          path: ["cases", "case_001", "nodes", "assessment", "choices", 1, "target", "nodeId"],
        },
        {
          code: "NODE_REFERENCE_INVALID",
          objectId: "case_001",
          path: ["cases", "case_001", "startNodeId"],
        },
      ],
    );
  });

  it("checks resolution attribute and flag effects", () => {
    expectSemanticIssues(
      (catalog) => {
        const effects = catalog.cases.case_001.resolutions.warning.effects;
        effects.attributeDeltas.missing_attribute = 1;
        effects.setFlags.missing_flag = true;
      },
      [
        {
          code: "ATTRIBUTE_REFERENCE_INVALID",
          objectId: "case_001",
          path: [
            "cases",
            "case_001",
            "resolutions",
            "warning",
            "effects",
            "attributeDeltas",
            "missing_attribute",
          ],
        },
        {
          code: "FLAG_REFERENCE_INVALID",
          objectId: "case_001",
          path: [
            "cases",
            "case_001",
            "resolutions",
            "warning",
            "effects",
            "setFlags",
            "missing_flag",
          ],
        },
      ],
    );
  });

  it("checks reference-bearing predicates in unlock, story, and ending conditions", () => {
    expectSemanticIssues(
      (catalog) => {
        catalog.unlockRules[0].when.all = [
          { type: "caseResolved", caseId: "missing_case" },
          {
            type: "caseResolved",
            caseId: "case_001",
            resolutionId: "review_required",
          },
        ];
        catalog.storyRules[0].when.all = [
          { type: "attributeAtLeast", attributeId: "missing_min_attribute", value: 1 },
          { type: "attributeAtMost", attributeId: "missing_max_attribute", value: 1 },
        ];
        catalog.endings.balanced.when.all = [
          { type: "flagEquals", flagId: "missing_flag", value: true },
        ];
      },
      [
        {
          code: "FLAG_REFERENCE_INVALID",
          objectId: "balanced",
          path: ["endings", "balanced", "when", "all", 0, "flagId"],
        },
        {
          code: "ATTRIBUTE_REFERENCE_INVALID",
          objectId: "story_after_case_001_rule",
          path: ["storyRules", 0, "when", "all", 0, "attributeId"],
        },
        {
          code: "ATTRIBUTE_REFERENCE_INVALID",
          objectId: "story_after_case_001_rule",
          path: ["storyRules", 0, "when", "all", 1, "attributeId"],
        },
        {
          code: "CASE_REFERENCE_INVALID",
          objectId: "unlock_case_002_after_case_001",
          path: ["unlockRules", 0, "when", "all", 0, "caseId"],
        },
        {
          code: "RESOLUTION_REFERENCE_INVALID",
          objectId: "unlock_case_002_after_case_001",
          path: ["unlockRules", 0, "when", "all", 1, "resolutionId"],
        },
      ],
    );
  });

  it("checks unlock, ordinary story, and ending story targets", () => {
    expectSemanticIssues(
      (catalog) => {
        catalog.unlockRules[0].caseIds = ["missing_case"];
        catalog.storyRules[0].storyId = "missing_story";
        catalog.endings.balanced.storyId = "missing_ending_story";
      },
      [
        {
          code: "STORY_REFERENCE_INVALID",
          objectId: "balanced",
          path: ["endings", "balanced", "storyId"],
        },
        {
          code: "STORY_REFERENCE_INVALID",
          objectId: "story_after_case_001_rule",
          path: ["storyRules", 0, "storyId"],
        },
        {
          code: "CASE_REFERENCE_INVALID",
          objectId: "unlock_case_002_after_case_001",
          path: ["unlockRules", 0, "caseIds", 0],
        },
      ],
    );
  });

  it("requires IDs to be unique within each progression rule collection", () => {
    expectSemanticIssues(
      (catalog) => {
        catalog.unlockRules.push(structuredClone(catalog.unlockRules[0]));
        catalog.storyRules.push(structuredClone(catalog.storyRules[0]));
      },
      [
        {
          code: "STORY_RULE_ID_DUPLICATE",
          objectId: "story_after_case_001_rule",
          path: ["storyRules", 1, "id"],
        },
        {
          code: "UNLOCK_RULE_ID_DUPLICATE",
          objectId: "unlock_case_002_after_case_001",
          path: ["unlockRules", 1, "id"],
        },
      ],
    );
  });

  it("requires ending priorities and ending story IDs to be unique", () => {
    expectSemanticIssues(
      (catalog) => {
        catalog.endings.fallback.priority = catalog.endings.balanced.priority;
        catalog.endings.fallback.storyId = catalog.endings.balanced.storyId;
      },
      [
        {
          code: "ENDING_PRIORITY_DUPLICATE",
          objectId: "fallback",
          path: ["endings", "fallback", "priority"],
        },
        {
          code: "ENDING_STORY_ID_DUPLICATE",
          objectId: "fallback",
          path: ["endings", "fallback", "storyId"],
        },
      ],
    );
  });

  it("keeps ending stories out of initial and ordinary story queues", () => {
    expectSemanticIssues(
      (catalog) => {
        catalog.initial.storyIds = ["ending_balanced"];
        catalog.storyRules[0].storyId = "ending_fallback";
      },
      [
        {
          code: "ENDING_STORY_IN_INITIAL",
          objectId: "initial",
          path: ["initial", "storyIds", 0],
        },
        {
          code: "ENDING_STORY_IN_STORY_RULE",
          objectId: "story_after_case_001_rule",
          path: ["storyRules", 0, "storyId"],
        },
      ],
    );
  });

  it("does not accept Object prototype properties as declared IDs", () => {
    expectSemanticIssues(
      (catalog) => {
        catalog.initial.caseIds = ["toString"];
        catalog.initial.storyIds = ["toString"];
        catalog.cases.case_001.startNodeId = "__proto__";
        catalog.cases.case_001.nodes.assessment.choices[0].target = {
          type: "resolution",
          resolutionId: "toString",
        };
        catalog.unlockRules[0].when.all = [{ type: "caseResolved", caseId: "toString" }];
      },
      [
        {
          code: "RESOLUTION_REFERENCE_INVALID",
          objectId: "case_001",
          path: [
            "cases",
            "case_001",
            "nodes",
            "assessment",
            "choices",
            0,
            "target",
            "resolutionId",
          ],
        },
        {
          code: "NODE_REFERENCE_INVALID",
          objectId: "case_001",
          path: ["cases", "case_001", "startNodeId"],
        },
        {
          code: "CASE_REFERENCE_INVALID",
          objectId: "initial",
          path: ["initial", "caseIds", 0],
        },
        {
          code: "STORY_REFERENCE_INVALID",
          objectId: "initial",
          path: ["initial", "storyIds", 0],
        },
        {
          code: "CASE_REFERENCE_INVALID",
          objectId: "unlock_case_002_after_case_001",
          path: ["unlockRules", 0, "when", "all", 0, "caseId"],
        },
      ],
    );
  });
});
