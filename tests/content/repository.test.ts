import { describe, expect, it } from "vitest";

import {
  MINIMAL_GAME_CONTENT,
  MINIMAL_LOCALIZATIONS,
} from "../../src/content/fixtures/minimalCatalog";
import { ContentRepositoryError, FakeSplitContentRepository } from "../../src/content/repository";
import type { GameContentCatalog } from "../../src/content/schema";
import type { ContentValidationIssue } from "../../src/content/validate";

const cloneCatalog = (): GameContentCatalog => structuredClone(MINIMAL_GAME_CONTENT);
const CONTENT_REF = {
  packageId: MINIMAL_GAME_CONTENT.manifest.packageId,
  version: MINIMAL_GAME_CONTENT.manifest.version,
} as const;

const invalidMutations: readonly {
  readonly name: string;
  readonly expectedCode: ContentValidationIssue["code"];
  readonly mutate: (catalog: GameContentCatalog) => void;
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

describe("FakeSplitContentRepository content validation", () => {
  it("rejects structurally invalid registration with readonly validation issues as cause", () => {
    const malformed = cloneCatalog() as unknown as {
      manifest: { packageId?: string };
    };
    delete malformed.manifest.packageId;

    try {
      new FakeSplitContentRepository().register({
        gameContent: malformed as unknown as GameContentCatalog,
        localizations: MINIMAL_LOCALIZATIONS,
      });
      throw new Error("Expected registration to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ContentRepositoryError);
      const repositoryError = error as ContentRepositoryError;
      expect(repositoryError).toMatchObject({
        code: "INVALID_CONTENT",
        message: "The supplied game content catalog is invalid.",
      });
      const issues = issuesFrom(repositoryError);
      expect(issues[0].code).toBe("GAME_CONTENT_SCHEMA_INVALID");
      expect(Object.isFrozen(issues)).toBe(true);
      expect(Object.isFrozen(issues[0])).toBe(true);
      expect(Object.isFrozen(issues[0].path)).toBe(true);
    }
  });

  it.each(invalidMutations)("rejects $name during registration", ({ mutate, expectedCode }) => {
    const catalog = cloneCatalog();
    mutate(catalog);

    try {
      new FakeSplitContentRepository().register({
        gameContent: catalog,
        localizations: MINIMAL_LOCALIZATIONS,
      });
      throw new Error("Expected registration to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ContentRepositoryError);
      const repositoryError = error as ContentRepositoryError;
      expect(repositoryError.code).toBe("INVALID_CONTENT");
      expect(repositoryError.message).toContain("supplied game content catalog is invalid");
      expect(issuesFrom(repositoryError).map((issue) => issue.code)).toContain(expectedCode);
    }
  });

  it("revalidates stored content during load and preserves its issues as cause", async () => {
    const repository = new FakeSplitContentRepository([
      { gameContent: MINIMAL_GAME_CONTENT, localizations: MINIMAL_LOCALIZATIONS },
    ]);
    const corrupted = cloneCatalog();
    corrupted.cases.case_001.startNodeId = "missing_start";
    const internal = repository as unknown as {
      gameCatalogs: Map<string, GameContentCatalog>;
    };
    internal.gameCatalogs.set(
      JSON.stringify([CONTENT_REF.packageId, CONTENT_REF.version]),
      corrupted,
    );

    try {
      await repository.loadGameContent(CONTENT_REF);
      throw new Error("Expected load to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ContentRepositoryError);
      const repositoryError = error as ContentRepositoryError;
      expect(repositoryError).toMatchObject({
        code: "INVALID_CONTENT",
        message: "The stored game content catalog is invalid.",
      });
      expect(issuesFrom(repositoryError)[0].code).toBe("NODE_REFERENCE_INVALID");
    }
  });

  it("isolates registration input and every loaded catalog from shared mutation", async () => {
    const source = cloneCatalog();
    const originalOrder = source.cases.case_001.order;
    const repository = new FakeSplitContentRepository();
    repository.register({ gameContent: source, localizations: MINIMAL_LOCALIZATIONS });
    source.cases.case_001.order = 999;

    const first = await repository.loadGameContent(CONTENT_REF);
    const second = await repository.loadGameContent(CONTENT_REF);
    expect(first).not.toBe(second);
    expect(first.cases.case_001).not.toBe(second.cases.case_001);
    expect(first.cases.case_001.order).toBe(originalOrder);

    first.cases.case_001.nodes.assessment.choices[0].id = "mutated loaded copy";
    const third = await repository.loadGameContent(CONTENT_REF);
    expect(third.cases.case_001.nodes.assessment.choices[0].id).not.toBe("mutated loaded copy");
  });
});
