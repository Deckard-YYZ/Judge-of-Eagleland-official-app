import { describe, expect, it } from "vitest";

import { MINIMAL_CATALOG } from "../../src/content/fixtures/minimalCatalog";
import { ContentRepositoryError, FakeContentRepository } from "../../src/content/repository";
import type { ContentCatalog } from "../../src/content/schema";
import type { ContentValidationIssue } from "../../src/content/validate";

const cloneCatalog = (): ContentCatalog => structuredClone(MINIMAL_CATALOG);
const CONTENT_REF = {
  packageId: MINIMAL_CATALOG.manifest.packageId,
  version: MINIMAL_CATALOG.manifest.version,
} as const;

const invalidMutations: readonly {
  readonly name: string;
  readonly expectedCode: ContentValidationIssue["code"];
  readonly mutate: (catalog: ContentCatalog) => void;
}[] = [
  {
    name: "missing start",
    expectedCode: "NODE_REFERENCE_INVALID",
    mutate: (catalog) => {
      catalog.cases.case_001.startNodeId = "missing_start";
    },
  },
  {
    name: "missing choice target",
    expectedCode: "RESOLUTION_REFERENCE_INVALID",
    mutate: (catalog) => {
      catalog.cases.case_001.nodes.assessment.choices[0].target = {
        type: "resolution",
        resolutionId: "missing_resolution",
      };
    },
  },
  {
    name: "invalid progression target",
    expectedCode: "CASE_REFERENCE_INVALID",
    mutate: (catalog) => {
      catalog.unlockRules[0].caseIds = ["missing_case"];
    },
  },
  {
    name: "reachable graph cycle",
    expectedCode: "CASE_GRAPH_CYCLE",
    mutate: (catalog) => {
      catalog.cases.case_001.nodes.assessment.choices[1].target = {
        type: "node",
        nodeId: "assessment",
      };
    },
  },
  {
    name: "missing story asset",
    expectedCode: "ASSET_REFERENCE_INVALID",
    mutate: (catalog) => {
      const step = catalog.stories.ending_balanced.steps[0];
      if (step.type !== "video") {
        throw new Error("Expected fixture video step.");
      }
      step.assetId = "missing_asset";
    },
  },
];

const issuesFrom = (error: ContentRepositoryError): readonly ContentValidationIssue[] => {
  expect(Array.isArray(error.cause)).toBe(true);
  return error.cause as readonly ContentValidationIssue[];
};

describe("FakeContentRepository content validation", () => {
  it("rejects structurally invalid registration with readonly validation issues as cause", () => {
    const malformed = cloneCatalog() as unknown as {
      manifest: { title?: string };
    };
    delete malformed.manifest.title;

    try {
      new FakeContentRepository().register(malformed as unknown as ContentCatalog);
      throw new Error("Expected registration to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ContentRepositoryError);
      const repositoryError = error as ContentRepositoryError;
      expect(repositoryError).toMatchObject({
        code: "INVALID_CONTENT",
        message: "The supplied content catalog is invalid (1 content issue(s)).",
      });
      const issues = issuesFrom(repositoryError);
      expect(issues[0].code).toBe("CONTENT_SCHEMA_INVALID");
      expect(Object.isFrozen(issues)).toBe(true);
      expect(Object.isFrozen(issues[0])).toBe(true);
      expect(Object.isFrozen(issues[0].path)).toBe(true);
    }
  });

  it.each(invalidMutations)("rejects $name during registration", ({ mutate, expectedCode }) => {
    const catalog = cloneCatalog();
    mutate(catalog);

    try {
      new FakeContentRepository().register(catalog);
      throw new Error("Expected registration to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ContentRepositoryError);
      const repositoryError = error as ContentRepositoryError;
      expect(repositoryError.code).toBe("INVALID_CONTENT");
      expect(repositoryError.message).toContain("supplied content catalog is invalid");
      expect(issuesFrom(repositoryError).map((issue) => issue.code)).toContain(expectedCode);
    }
  });

  it("revalidates stored content during load and preserves its issues as cause", async () => {
    const repository = new FakeContentRepository([MINIMAL_CATALOG]);
    const corrupted = cloneCatalog();
    corrupted.cases.case_001.startNodeId = "missing_start";
    const internal = repository as unknown as {
      catalogs: Map<string, ContentCatalog>;
    };
    internal.catalogs.set(JSON.stringify([CONTENT_REF.packageId, CONTENT_REF.version]), corrupted);

    try {
      await repository.load(CONTENT_REF);
      throw new Error("Expected load to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ContentRepositoryError);
      const repositoryError = error as ContentRepositoryError;
      expect(repositoryError).toMatchObject({
        code: "INVALID_CONTENT",
        message: "The stored content catalog is invalid (1 content issue(s)).",
      });
      expect(issuesFrom(repositoryError)[0].code).toBe("NODE_REFERENCE_INVALID");
    }
  });

  it("isolates registration input and every loaded catalog from shared mutation", async () => {
    const source = cloneCatalog();
    const originalTitle = source.cases.case_001.title;
    const repository = new FakeContentRepository();
    repository.register(source);
    source.cases.case_001.title = "mutated after registration";

    const first = await repository.load(CONTENT_REF);
    const second = await repository.load(CONTENT_REF);
    expect(first).not.toBe(second);
    expect(first.cases.case_001).not.toBe(second.cases.case_001);
    expect(first.cases.case_001.title).toBe(originalTitle);

    first.cases.case_001.nodes.assessment.choices[0].text = "mutated loaded copy";
    const third = await repository.load(CONTENT_REF);
    expect(third.cases.case_001.nodes.assessment.choices[0].text).not.toBe("mutated loaded copy");
  });
});
