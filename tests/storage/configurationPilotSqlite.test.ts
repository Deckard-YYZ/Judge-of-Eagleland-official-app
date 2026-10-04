import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDemoSave } from "../../src/app/demoSession";
import { ACTION_INPUT_GAME_CONTENT } from "../../src/app/actionInputContent";
import { migrateStoredSaveEnvelope } from "../../src/storage/migrateSave";
import { SqliteProfileRepository } from "../../src/storage/profileRepository";
import { SqliteSaveRepository } from "../../src/storage/sqliteSaveRepository";
import type { SqlDatabase } from "../../src/storage/schema";
import {
  createSqliteTestDatabase,
  type SqliteTestDatabase,
} from "../fixtures/storage/sqliteTestDatabase";
import {
  PILOT_NOW,
  pilotInput,
  pilotSave,
  pilotSession,
  pilotVerdict,
  preparePilotVerdict,
} from "../fixtures/configurationPilot";

describe("save5 configuration facts using real SQLite and Session CAS", () => {
  let db: SqliteTestDatabase;
  let saves: SqliteSaveRepository;
  beforeEach(async () => {
    db = createSqliteTestDatabase();
    saves = new SqliteSaveRepository(db.database);
    await new SqliteProfileRepository(db.database).create({
      profileId: "pilot-profile",
      loginName: "pilot",
      displayName: "Pilot",
      createdAt: PILOT_NOW,
    });
  });
  afterEach(async () => {
    await db.cleanup();
  });

  it("reads v3 without writing or rebinding and upgrades only the next successful CAS", async () => {
    const legacy = {
      ...createDemoSave("pilot-profile", "legacy", ACTION_INPUT_GAME_CONTENT, PILOT_NOW),
      saveSchemaVersion: 3,
    };
    const raw = JSON.stringify(legacy.state);
    await db.database.execute(
      "INSERT INTO saves (save_id,profile_id,revision,save_schema_version,content_package_id,content_version,state_json,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        legacy.saveId,
        legacy.profileId,
        0,
        3,
        legacy.contentRef.packageId,
        legacy.contentRef.version,
        raw,
        PILOT_NOW,
        PILOT_NOW,
      ],
    );
    const readRaw = () =>
      db.database.select<{
        save_schema_version: number;
        state_json: string;
        content_package_id: string;
        content_version: string;
      }>(
        "SELECT save_schema_version,state_json,content_package_id,content_version FROM saves WHERE save_id=$1",
        [legacy.saveId],
      );
    const loaded = await saves.load(legacy.saveId, legacy.profileId);
    expect(loaded).toEqual({ ...legacy, saveSchemaVersion: 5 });
    expect((await readRaw())[0]).toMatchObject({
      save_schema_version: 3,
      state_json: raw,
      content_package_id: legacy.contentRef.packageId,
      content_version: legacy.contentRef.version,
    });
    expect(migrateStoredSaveEnvelope(loaded)).toEqual(loaded);
    await saves.commit({
      saveId: legacy.saveId,
      profileId: legacy.profileId,
      expectedRevision: 0,
      nextState: loaded!.state,
      updatedAt: PILOT_NOW,
    });
    const committedRow = (await readRaw())[0];
    expect(committedRow).toMatchObject({
      save_schema_version: 5,
      content_package_id: legacy.contentRef.packageId,
      content_version: legacy.contentRef.version,
    });
    expect(JSON.parse(committedRow.state_json)).toEqual(legacy.state);
  });

  it("rejects a v3 ledger and retains historical queue invariants", () => {
    const legacy = {
      ...createDemoSave("pilot-profile", "legacy", ACTION_INPUT_GAME_CONTENT, PILOT_NOW),
      saveSchemaVersion: 3,
    };
    expect(() =>
      migrateStoredSaveEnvelope({ ...legacy, state: { ...legacy.state, configurationFacts: [] } }),
    ).toThrow();
    expect(() =>
      migrateStoredSaveEnvelope({
        ...legacy,
        state: { ...legacy.state, pendingStoryIds: ["x", "x"] },
      }),
    ).toThrow();
    expect(() =>
      migrateStoredSaveEnvelope({
        ...legacy,
        state: { ...legacy.state, pendingStoryIds: ["x"], completedStoryIds: ["x"] },
      }),
    ).toThrow();
  });

  it("round-trips the actual verdict, ledger, interaction queue, dispatch and retry checkpoint", async () => {
    await saves.create(pilotSave());
    const { session } = await pilotSession(saves);
    await preparePilotVerdict(session);
    await session.dispatch(pilotVerdict);
    const state = session.getSnapshot().state!;
    const row = (
      await db.database.select<{
        revision: number;
        save_schema_version: number;
        state_json: string;
      }>("SELECT revision,save_schema_version,state_json FROM saves WHERE save_id=$1", [
        "pilot-save",
      ])
    )[0];
    expect(row).toMatchObject({ revision: 3, save_schema_version: 5 });
    expect(JSON.parse(row.state_json)).toEqual(state);
    expect(state.configurationFacts?.at(-1)).toMatchObject({
      hookIds: ["after_intake"],
      dispatch: { status: "dispatched", caseId: "followup" },
    });
    const reopened = new SqliteSaveRepository(db.openConnection());
    expect((await reopened.load("pilot-save", "pilot-profile"))?.state).toEqual(state);
    await session.dispatch(pilotInput("wave"));
    await session.reload();
    expect(session.getSnapshot().state).toMatchObject({
      attributes: { input_errors: 1, authority: 1 },
      storyCheckpoint: { resumeStepId: "required_action" },
      pendingStoryIds: ["judgment_notice"],
    });
    await session.dispatch(pilotInput("salute"));
    await session.reload();
    expect(session.getSnapshot().state?.completedStoryIds).toEqual(["judgment_notice"]);
    expect(session.getSnapshot().state?.configurationFacts).toEqual(state.configurationFacts);
  });

  it("publishes no candidate hook or dispatch facts after a failed native update", async () => {
    await saves.create(pilotSave());
    const prepared = await pilotSession(saves);
    await preparePilotVerdict(prepared.session);
    const before = (await saves.load("pilot-save", "pilot-profile"))!;
    const failing: SqlDatabase = {
      select: (query, values) => db.database.select(query, values),
      execute: async () => {
        throw new Error("native update failed before commit");
      },
    };
    const { session } = await pilotSession(new SqliteSaveRepository(failing));
    expect(await session.dispatch(pilotVerdict)).toMatchObject({ ok: false });
    expect(session.getSnapshot().state).toEqual(before.state);
    expect(await saves.load("pilot-save", "pilot-profile")).toEqual(before);
    expect(session.getSnapshot().state?.cases.followup).toBeUndefined();
    expect(session.getSnapshot().state?.pendingStoryIds).toEqual([]);
  });

  it("rejects a competing CAS and restores the winner's facts without repeating triggers", async () => {
    await saves.create(pilotSave());
    const first = await pilotSession(saves);
    await preparePilotVerdict(first.session);
    const second = await pilotSession(new SqliteSaveRepository(db.openConnection()));
    const stale = second.session.getSnapshot().state!;
    expect(await first.session.dispatch(pilotVerdict)).toMatchObject({ ok: true });
    const committed = await saves.load("pilot-save", "pilot-profile");
    expect(await second.session.dispatch(pilotVerdict)).toMatchObject({
      ok: false,
      code: "REVISION_CONFLICT",
    });
    expect(second.session.getSnapshot().state).toEqual(stale);
    expect(await saves.load("pilot-save", "pilot-profile")).toEqual(committed);
    await second.session.reload();
    expect(second.session.getSnapshot().state).toEqual(committed?.state);
    expect(second.session.getSnapshot().state?.pendingStoryIds).toEqual(["judgment_notice"]);
    expect(second.session.getSnapshot().state?.configurationFacts).toHaveLength(4);
  });
});
