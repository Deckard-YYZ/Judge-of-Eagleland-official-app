import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrapApplication } from "../../src/app/bootstrap";
import type { ProfileEntryResult } from "../../src/application/profileEntry";
import type { GameSessionView } from "../../src/application/gameSessionView";
import { BundledSplitContentRepository } from "../../src/content/bundledRepository";
import type { BundledPackageReader } from "../../src/platform/contentResources";
import { GameStateSchema, type GameState } from "../../src/game/model";
import {
  createSqliteTestDatabase,
  type NodeSqliteTestDatabase,
  type SqliteTestDatabase,
} from "../fixtures/storage/sqliteTestDatabase";

// Replace only the native resource transport: the installed schema-v4 files pass
// through the same full package loader and production repository as the desktop.
const readInstalledPackage: BundledPackageReader = async ({ packageId, version }) => {
  const root = new URL(`../../content/${packageId}/${version}/`, import.meta.url);
  const fileInventory = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(fileURLToPath(root), join(entry.parentPath, entry.name)).replaceAll("\\", "/"),
    );
  const sources = await Promise.all(
    fileInventory
      .filter((source) => source.endsWith(".json"))
      .map(async (source) => ({ source, text: await readFile(new URL(source, root), "utf8") })),
  );
  return { sources, fileInventory };
};

const fixtures: SqliteTestDatabase[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.cleanup();
});

function newDatabase() {
  const fixture = createSqliteTestDatabase();
  fixtures.push(fixture);
  return fixture;
}

async function boot(database: NodeSqliteTestDatabase) {
  const app = await bootstrapApplication({
    detectRuntime: () => "desktop",
    storageOptions: { loadDatabase: async () => database },
    desktopProfileOptions: {
      contentRepository: new BundledSplitContentRepository(readInstalledPackage),
      tutorialEnabled: true,
    },
  });
  if (app.runtime !== "desktop") throw new Error("Expected real desktop bootstrap.");
  return app;
}

function entered(result: ProfileEntryResult) {
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

// Read persisted bytes directly rather than relying on the session or save mapper.
function row(database: NodeSqliteTestDatabase, saveId: string) {
  const value = database.native.prepare("SELECT * FROM saves WHERE save_id = ?").get(saveId);
  if (!value) throw new Error("Missing persisted save.");
  return {
    ...value,
    revision: Number(value.revision),
    state: GameStateSchema.parse(JSON.parse(String(value.state_json))),
  };
}

const finalChoice = {
  type: "chooseOption",
  caseId: "case_001",
  nodeId: "disposition",
  choiceId: "formal_warning",
} as const;
async function completeTutorial(session: GameSessionView) {
  expect(
    (
      await session.dispatch({
        type: "submitStoryInput",
        storyId: "tutorial_voice_order",
        stepId: "order",
        actionId: "salute",
      })
    ).ok,
  ).toBe(true);
  expect(
    (await session.dispatch({ type: "completeStory", storyId: "tutorial_voice_order" })).ok,
  ).toBe(true);
}
async function reachDisposition(session: GameSessionView) {
  await completeTutorial(session);
  expect((await session.dispatch({ type: "startCase", caseId: "case_001" })).ok).toBe(true);
  expect(
    (
      await session.dispatch({
        type: "chooseOption",
        caseId: "case_001",
        nodeId: "assessment",
        choiceId: "confirm_violation",
      })
    ).ok,
  ).toBe(true);
}

describe("desktop vertical slice with installed content and real SQLite", () => {
  it("registers, commits each choice, and restores identical saves across fully closed connections", async () => {
    const fixture = newDatabase();
    let database = fixture.database;
    let app = await boot(database);
    let entry = entered(await app.profileEntry.register("Vertical Slice Archivist"));
    const profileId = entry.profile.profileId;
    const saveId = entry.session.getSnapshot().envelope!.saveId;
    expect(database.native.prepare("SELECT profile_id, display_name FROM profiles").all()).toEqual([
      { profile_id: profileId, display_name: "Vertical Slice Archivist" },
    ]);
    expect(row(database, saveId)).toMatchObject({
      revision: 0,
      profile_id: profileId,
      state: { cases: { case_001: { status: "pending" } } },
    });
    await completeTutorial(entry.session);
    expect(row(database, saveId)).toMatchObject({
      revision: 2,
      state: { completedStoryIds: ["tutorial_voice_order"] },
    });
    expect((await entry.session.dispatch({ type: "startCase", caseId: "case_001" })).ok).toBe(true);
    expect(row(database, saveId)).toMatchObject({
      revision: 3,
      state: {
        cases: { case_001: { status: "active", currentNodeId: "assessment", history: [] } },
      },
    });
    expect(
      (
        await entry.session.dispatch({
          type: "chooseOption",
          caseId: "case_001",
          nodeId: "assessment",
          choiceId: "confirm_violation",
        })
      ).ok,
    ).toBe(true);
    const intermediate = row(database, saveId);
    expect(intermediate).toMatchObject({
      revision: 4,
      state: {
        cases: {
          case_001: {
            currentNodeId: "disposition",
            history: [{ nodeId: "assessment", choiceId: "confirm_violation" }],
          },
        },
      },
    });

    // There are no live connections at either restart boundary. A new bootstrap
    // rebuilds repositories, content, Profile entry, session, and localization.
    await database.close();
    database = fixture.openConnection();
    app = await boot(database);
    entry = entered(await app.profileEntry.enter(profileId));
    expect(entry.session.getSnapshot()).toMatchObject({
      envelope: { saveId, revision: 4 },
      state: intermediate.state,
    });
    expect(row(database, saveId)).toEqual(intermediate);
    expect((await entry.session.dispatch(finalChoice)).ok).toBe(true);
    const completed = row(database, saveId);
    expect(completed).toMatchObject({
      revision: 5,
      state: {
        attributes: { restraint: 51, authority: 51 },
        flags: { first_case_closed: true, second_case_reviewed: false },
        pendingStoryIds: ["story_after_case_001", "inspection_after_case_001"],
        cases: {
          case_001: {
            status: "resolved",
            resolutionId: "warning",
            finalChoiceId: "formal_warning",
            history: [
              { nodeId: "assessment", choiceId: "confirm_violation" },
              { nodeId: "disposition", choiceId: "formal_warning" },
            ],
            snapshot: {
              resolvedOrder: 1,
              attributeChanges: [
                { attributeId: "authority", before: 50, after: 51, actualDelta: 1 },
                { attributeId: "restraint", before: 50, after: 51, actualDelta: 1 },
              ],
            },
          },
          case_002: { status: "pending" },
        },
      },
    });
    await database.close();
    database = fixture.openConnection();
    app = await boot(database);
    entry = entered(await app.profileEntry.enter(profileId));
    expect(entry.session.getSnapshot().envelope).toMatchObject({ saveId, revision: 5 });
    expect(entry.session.getSnapshot().state).toEqual(completed.state);
    expect(row(database, saveId)).toEqual(completed);
    expect(database.native.prepare("SELECT count(*) AS total FROM saves").get()).toEqual({
      total: 1,
    });
  });

  it("recovers a real competing SQL revision without applying settlement twice", async () => {
    const fixture = newDatabase();
    const first = await boot(fixture.database);
    const owner = entered(await first.profileEntry.register("Conflict Archivist"));
    await reachDisposition(owner.session);
    const secondDatabase = fixture.openConnection();
    const second = await boot(secondDatabase);
    const stale = entered(await second.profileEntry.enter(owner.profile.profileId));
    const saveId = owner.session.getSnapshot().envelope!.saveId;
    expect((await owner.session.dispatch(finalChoice)).ok).toBe(true);
    const committed = row(fixture.database, saveId);
    expect(await stale.session.dispatch(finalChoice)).toMatchObject({
      ok: false,
      code: "REVISION_CONFLICT",
    });
    expect(stale.session.getSnapshot().status).toBe("needsReload");
    expect(await stale.session.dispatch(finalChoice)).toMatchObject({
      ok: false,
      code: "RELOAD_REQUIRED",
    });
    expect(row(secondDatabase, saveId)).toEqual(committed);
    expect((await stale.session.reload()).ok).toBe(true);
    expect(stale.session.getSnapshot().state).toEqual(committed.state);
    expect((await stale.session.dispatch(finalChoice)).ok).toBe(false);
    expect(row(secondDatabase, saveId)).toEqual(committed);
    expect(committed).toMatchObject({
      revision: 5,
      state: { attributes: { restraint: 51, authority: 51 } },
    });
  });

  it("rejects a structurally valid corrupt saved path without writing or exposing ready", async () => {
    const fixture = newDatabase();
    const app = await boot(fixture.database);
    const entry = entered(await app.profileEntry.register("Integrity Archivist"));
    const saveId = entry.session.getSnapshot().envelope!.saveId;
    const corrupt: GameState = structuredClone(entry.session.getSnapshot().state!);
    corrupt.cases.case_001 = { status: "active", currentNodeId: "missing_node", history: [] };
    expect(GameStateSchema.safeParse(corrupt).success).toBe(true);
    fixture.database.native
      .prepare("UPDATE saves SET state_json = ? WHERE save_id = ?")
      .run(JSON.stringify(corrupt), saveId);
    const before = row(fixture.database, saveId);
    const statuses: string[] = [];
    entry.session.subscribe(() => statuses.push(entry.session.getSnapshot().status));
    expect(await entry.session.reload()).toMatchObject({ ok: false, code: "INVALID_SAVE" });
    expect(statuses).not.toContain("ready");
    expect(entry.session.getSnapshot()).toMatchObject({ status: "error", state: null });
    expect((await app.profileEntry.enter(entry.profile.profileId)).ok).toBe(false);
    expect(row(fixture.database, saveId)).toEqual(before);
  });
});
