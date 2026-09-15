import { describe, expect, it } from "vitest";
import { ContentCatalogSchema, ContentManifestSchema } from "../../src/content/schema";
import { FakeContentRepository } from "../../src/content/repository";
import { MINIMAL_CATALOG } from "../../src/content/fixtures/minimalCatalog";
import { GameCommandSchema, TransitionResultSchema } from "../../src/game/commands";
import { GameStateSchema, SaveEnvelopeSchema } from "../../src/game/model";

const baseState = {
  phase: { type: "playing" as const },
  attributes: { restraint: 50, authority: 50 },
  flags: { first_case_closed: false },
  cases: {
    case_001: { status: "pending" as const },
  },
  pendingStoryIds: [],
  completedStoryIds: [],
};

const baseSave = {
  saveId: "save-1",
  profileId: "profile-1",
  revision: 0,
  saveSchemaVersion: 1,
  contentRef: {
    packageId: MINIMAL_CATALOG.manifest.packageId,
    version: MINIMAL_CATALOG.manifest.version,
  },
  createdAt: "2026-09-14T10:00:00.000Z",
  updatedAt: "2026-09-14T10:00:00.000Z",
  state: baseState,
};

describe("content and state contracts", () => {
  it("accepts the complete minimal fixture", () => {
    expect(ContentCatalogSchema.parse(MINIMAL_CATALOG)).toEqual(MINIMAL_CATALOG);
    expect(MINIMAL_CATALOG.cases.case_001.nodes.assessment.choices).toHaveLength(2);
    expect(MINIMAL_CATALOG.cases.case_002).toBeDefined();
  });

  it("rejects unsupported content schema versions", () => {
    expect(() =>
      ContentManifestSchema.parse({
        packageId: "pkg",
        version: "2.0.0",
        contentSchemaVersion: 2,
        title: "future",
      }),
    ).toThrow();
  });

  it("keeps choice targets and command variants closed", () => {
    expect(() =>
      ContentCatalogSchema.parse({
        ...MINIMAL_CATALOG,
        cases: {
          ...MINIMAL_CATALOG.cases,
          case_001: {
            ...MINIMAL_CATALOG.cases.case_001,
            nodes: {
              ...MINIMAL_CATALOG.cases.case_001.nodes,
              assessment: {
                ...MINIMAL_CATALOG.cases.case_001.nodes.assessment,
                choices: [
                  {
                    id: "bad",
                    text: "bad",
                    target: {
                      type: "node",
                      nodeId: "assessment",
                      resolutionId: "warning",
                    },
                  },
                ],
              },
            },
          },
        },
      }),
    ).toThrow();

    expect(GameCommandSchema.parse({ type: "startCase", caseId: "case_001" })).toEqual({
      type: "startCase",
      caseId: "case_001",
    });
    expect(() => GameCommandSchema.parse({ type: "unknown" })).toThrow();
  });

  it("enforces serializable state invariants and result shape", () => {
    expect(GameStateSchema.parse(baseState)).toEqual(baseState);
    expect(() =>
      GameStateSchema.parse({
        ...baseState,
        pendingStoryIds: ["story-1"],
        completedStoryIds: ["story-1"],
      }),
    ).toThrow();

    expect(SaveEnvelopeSchema.parse(baseSave)).toEqual(baseSave);
    expect(
      TransitionResultSchema.parse({
        ok: true,
        nextState: baseState,
        feedback: [],
      }),
    ).toEqual({
      ok: true,
      nextState: baseState,
      feedback: [],
    });
  });

  it("loads only the exact content ref and clones returned catalogs", async () => {
    const repository = new FakeContentRepository([MINIMAL_CATALOG]);
    const loaded = await repository.load({
      packageId: MINIMAL_CATALOG.manifest.packageId,
      version: MINIMAL_CATALOG.manifest.version,
    });

    (loaded.cases.case_001.nodes.assessment.choices as Array<unknown>).pop();
    const reloaded = await repository.load({
      packageId: MINIMAL_CATALOG.manifest.packageId,
      version: MINIMAL_CATALOG.manifest.version,
    });

    expect(reloaded.cases.case_001.nodes.assessment.choices).toHaveLength(2);
    await expect(
      repository.load({
        packageId: MINIMAL_CATALOG.manifest.packageId,
        version: "9.9.9",
      }),
    ).rejects.toMatchObject({ code: "CONTENT_NOT_FOUND" });
  });
});
