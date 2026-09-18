import { describe, expect, it } from "vitest";
import { GameContentCatalogSchema, GameContentManifestSchema } from "../../src/content/schema";
import { FakeSplitContentRepository } from "../../src/content/repository";
import {
  MINIMAL_GAME_CONTENT,
  MINIMAL_LOCALIZATIONS,
} from "../../src/content/fixtures/minimalCatalog";
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
  storyCheckpoint: null,
};

const baseSave = {
  saveId: "save-1",
  profileId: "profile-1",
  revision: 0,
  saveSchemaVersion: 3,
  contentRef: {
    packageId: MINIMAL_GAME_CONTENT.manifest.packageId,
    version: MINIMAL_GAME_CONTENT.manifest.version,
  },
  createdAt: "2026-09-14T10:00:00.000Z",
  updatedAt: "2026-09-14T10:00:00.000Z",
  state: baseState,
};

describe("content and state contracts", () => {
  it("accepts the complete minimal fixture", () => {
    expect(GameContentCatalogSchema.parse(MINIMAL_GAME_CONTENT)).toEqual(MINIMAL_GAME_CONTENT);
    expect(MINIMAL_GAME_CONTENT.cases.case_001.nodes.assessment.choices).toHaveLength(2);
    expect(MINIMAL_GAME_CONTENT.cases.case_002).toBeDefined();
  });

  it("rejects unsupported content schema versions", () => {
    expect(() =>
      GameContentManifestSchema.parse({
        packageId: "pkg",
        version: "2.0.0",
        contentSchemaVersion: 5,
        defaultLocale: "zh-CN",
        supportedLocales: ["zh-CN"],
      }),
    ).toThrow();
  });

  it("keeps choice targets and command variants closed", () => {
    expect(() =>
      GameContentCatalogSchema.parse({
        ...MINIMAL_GAME_CONTENT,
        cases: {
          ...MINIMAL_GAME_CONTENT.cases,
          case_001: {
            ...MINIMAL_GAME_CONTENT.cases.case_001,
            nodes: {
              ...MINIMAL_GAME_CONTENT.cases.case_001.nodes,
              assessment: {
                ...MINIMAL_GAME_CONTENT.cases.case_001.nodes.assessment,
                choices: [
                  {
                    id: "bad",
                    hasAnnotation: false,
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
        storyCheckpoint: null,
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
    const repository = new FakeSplitContentRepository([
      { gameContent: MINIMAL_GAME_CONTENT, localizations: MINIMAL_LOCALIZATIONS },
    ]);
    const loaded = await repository.loadGameContent({
      packageId: MINIMAL_GAME_CONTENT.manifest.packageId,
      version: MINIMAL_GAME_CONTENT.manifest.version,
    });

    (loaded.cases.case_001.nodes.assessment.choices as Array<unknown>).pop();
    const reloaded = await repository.loadGameContent({
      packageId: MINIMAL_GAME_CONTENT.manifest.packageId,
      version: MINIMAL_GAME_CONTENT.manifest.version,
    });

    expect(reloaded.cases.case_001.nodes.assessment.choices).toHaveLength(2);
    await expect(
      repository.loadGameContent({
        packageId: MINIMAL_GAME_CONTENT.manifest.packageId,
        version: "9.9.9",
      }),
    ).rejects.toMatchObject({ code: "CONTENT_NOT_FOUND" });
  });
});
