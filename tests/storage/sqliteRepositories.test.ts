import { afterEach, beforeEach, describe, expect, it } from "vitest";

import saveV1Fixture from "../fixtures/storage/save-v1.json";
import saveV2Fixture from "../fixtures/storage/save-v2.json";
import { SqliteProfileRepository, type ProfileRecord } from "../../src/storage/profileRepository";
import { parseSaveEnvelopeForStorage } from "../../src/storage/saveRepository";
import { SqliteSaveRepository } from "../../src/storage/sqliteSaveRepository";
import { SqliteSettingsRepository } from "../../src/storage/settingsRepository";
import type { SqlDatabase } from "../../src/storage/schema";
import {
  createSqliteTestDatabase,
  type NodeSqliteTestDatabase,
  type SqliteTestDatabase,
} from "../fixtures/storage/sqliteTestDatabase";
import type { SaveEnvelope } from "../../src/game/model";

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const makeProfile = (
  profileId: string,
  loginName = profileId,
  createdAt = "2026-09-15T08:00:00.000Z",
): ProfileRecord => ({
  profileId,
  loginName,
  displayName: loginName,
  createdAt,
});

const makeV2Save = (): SaveEnvelope => parseSaveEnvelopeForStorage(cloneJson(saveV2Fixture));

interface RawSaveFixture {
  saveId: string;
  profileId: string;
  revision: number;
  saveSchemaVersion: number;
  contentRef: { packageId: string; version: string };
  createdAt: string;
  updatedAt: string;
  state: unknown;
}

const insertRawSave = async (
  database: NodeSqliteTestDatabase,
  save: RawSaveFixture,
): Promise<void> => {
  await database.execute(
    `INSERT INTO saves (
       save_id, profile_id, revision, save_schema_version,
       content_package_id, content_version, state_json, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      save.saveId,
      save.profileId,
      save.revision,
      save.saveSchemaVersion,
      save.contentRef.packageId,
      save.contentRef.version,
      JSON.stringify(save.state),
      save.createdAt,
      save.updatedAt,
    ],
  );
};

const withFailingExecute = (database: SqlDatabase, failure: Error): SqlDatabase => ({
  execute: async () => {
    throw failure;
  },
  select: <T extends Record<string, unknown>>(
    query: string,
    bindValues?: readonly unknown[],
  ): Promise<T[]> => database.select<T>(query, bindValues),
});

describe("SQLite storage repositories", () => {
  let testDatabase: SqliteTestDatabase;

  beforeEach(() => {
    testDatabase = createSqliteTestDatabase();
  });

  afterEach(async () => {
    await testDatabase.cleanup();
  });

  it("persists normalized Profiles and enforces both unique identities", async () => {
    const profiles = new SqliteProfileRepository(testDatabase.database);

    await profiles.create({
      ...makeProfile("profile-alpha", "  alpha  "),
      displayName: "  Alpha   User  ",
    });

    await expect(profiles.get("profile-alpha")).resolves.toEqual({
      profileId: "profile-alpha",
      loginName: "alpha",
      displayName: "Alpha User",
      createdAt: "2026-09-15T08:00:00.000Z",
    });
    await expect(profiles.findByLoginName("  alpha ")).resolves.toMatchObject({
      profileId: "profile-alpha",
    });
    await expect(profiles.list()).resolves.toHaveLength(1);

    await expect(
      profiles.create(makeProfile("profile-alpha", "other-login")),
    ).rejects.toMatchObject({ code: "PROFILE_ALREADY_EXISTS" });
    await expect(profiles.create(makeProfile("profile-beta", " alpha "))).rejects.toMatchObject({
      code: "PROFILE_ALREADY_EXISTS",
    });
    await expect(
      profiles.create({ ...makeProfile("profile-gamma"), loginName: "   " }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("does not relabel an unknown Profile write failure", async () => {
    const failure = new Error("profile transport failed");
    const profiles = new SqliteProfileRepository(
      withFailingExecute(testDatabase.database, failure),
    );

    await expect(profiles.create(makeProfile("profile-alpha"))).rejects.toBe(failure);
  });

  it("round-trips JSON Settings, keeps scopes isolated, and distinguishes null in list", async () => {
    const settings = new SqliteSettingsRepository(testDatabase.database);

    await settings.set("app", "volume", { master: 0.75, muted: false });
    await settings.set("profile:profile-alpha", "volume", null);

    await expect(settings.get("app", "volume")).resolves.toEqual({
      master: 0.75,
      muted: false,
    });
    await expect(settings.get("profile:profile-beta", "volume")).resolves.toBeNull();
    await expect(settings.get("profile:profile-alpha", "volume")).resolves.toBeNull();
    await expect(settings.list("profile:profile-alpha")).resolves.toEqual([
      { scope: "profile:profile-alpha", key: "volume", value: null },
    ]);

    await expect(settings.remove("profile:profile-alpha", "volume")).resolves.toBe(true);
    await expect(settings.remove("profile:profile-alpha", "volume")).resolves.toBe(false);
    await expect(settings.list("profile:profile-alpha")).resolves.toEqual([]);
  });

  it("rejects invalid Settings input/value and preserves unknown write errors", async () => {
    const settings = new SqliteSettingsRepository(testDatabase.database);

    await expect(settings.get("profile:", "volume")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(settings.get("profile:   ", "volume")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(settings.set("app", "   ", true)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(settings.set("app", "invalid", Number.NaN)).rejects.toMatchObject({
      code: "INVALID_VALUE",
    });
    await expect(settings.set("app", "invalid", BigInt(1))).rejects.toMatchObject({
      code: "INVALID_VALUE",
    });

    const failure = new Error("settings transport failed");
    const failingSettings = new SqliteSettingsRepository(
      withFailingExecute(testDatabase.database, failure),
    );
    await expect(failingSettings.set("app", "volume", 0.5)).rejects.toBe(failure);
  });

  it("reports a corrupt setting without replacing its original row", async () => {
    const settings = new SqliteSettingsRepository(testDatabase.database);
    await settings.set("app", "volume", 0.5);
    await testDatabase.database.execute(
      "UPDATE settings SET value_json = $1 WHERE scope = $2 AND setting_key = $3",
      ["{broken", "app", "volume"],
    );

    await expect(settings.get("app", "volume")).rejects.toMatchObject({
      code: "INVALID_SETTING",
    });
    await expect(settings.list("app")).rejects.toMatchObject({
      code: "INVALID_SETTING",
    });
    const raw = await testDatabase.database.select<{ value_json: string }>(
      "SELECT value_json FROM settings WHERE scope = $1 AND setting_key = $2",
      ["app", "volume"],
    );
    expect(raw[0]?.value_json).toBe("{broken");
  });

  it("creates v2 saves, isolates profiles, and lists only owned rows", async () => {
    const profiles = new SqliteProfileRepository(testDatabase.database);
    const saves = new SqliteSaveRepository(testDatabase.database);
    const save = makeV2Save();

    await profiles.create(makeProfile("profile-alpha"));
    await profiles.create(makeProfile("profile-beta"));
    await saves.create(save);

    await expect(saves.load(save.saveId, save.profileId)).resolves.toEqual(save);
    await expect(saves.load(save.saveId, "profile-beta")).resolves.toBeNull();
    await expect(saves.load("missing-save", save.profileId)).resolves.toBeNull();
    await expect(saves.listByProfile("profile-alpha")).resolves.toEqual([save]);
    await expect(saves.listByProfile("profile-beta")).resolves.toEqual([]);

    await expect(saves.create(save)).rejects.toMatchObject({
      code: "SAVE_ALREADY_EXISTS",
    });
    await expect(
      saves.create({ ...save, saveId: "orphan-save", profileId: "missing-profile" }),
    ).rejects.toMatchObject({ code: "PROFILE_MISMATCH" });
    await expect(saves.listByProfile("   ")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("commits with one atomic revision CAS and leaves stale input unchanged", async () => {
    const profiles = new SqliteProfileRepository(testDatabase.database);
    const saves = new SqliteSaveRepository(testDatabase.database);
    const save = makeV2Save();
    await profiles.create(makeProfile(save.profileId));
    await saves.create(save);

    const nextState = cloneJson(save.state);
    nextState.attributes.authority = 77;
    await expect(
      saves.commit({
        saveId: save.saveId,
        profileId: save.profileId,
        expectedRevision: save.revision,
        nextState,
        updatedAt: "2026-09-15T12:00:00.000Z",
      }),
    ).resolves.toEqual({ revision: 4 });

    nextState.attributes.authority = 99;
    await expect(
      saves.commit({
        saveId: save.saveId,
        profileId: save.profileId,
        expectedRevision: save.revision,
        nextState: save.state,
        updatedAt: "2026-09-15T12:01:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });

    const loaded = await saves.load(save.saveId, save.profileId);
    expect(loaded?.revision).toBe(4);
    expect(loaded?.state.attributes.authority).toBe(77);
    const raw = await testDatabase.database.select<{
      revision: number;
      save_schema_version: number;
      updated_at: string;
    }>("SELECT revision, save_schema_version, updated_at FROM saves WHERE save_id = $1", [
      save.saveId,
    ]);
    expect(raw[0]).toEqual({
      revision: 4,
      save_schema_version: 2,
      updated_at: "2026-09-15T12:00:00.000Z",
    });
  });

  it("allows exactly one concurrent SQLite commit for the same revision", async () => {
    const profiles = new SqliteProfileRepository(testDatabase.database);
    const saves = new SqliteSaveRepository(testDatabase.database);
    const secondConnection = testDatabase.openConnection();
    const concurrentSaves = new SqliteSaveRepository(secondConnection);
    const save = makeV2Save();
    await profiles.create(makeProfile(save.profileId));
    await saves.create(save);

    const firstState = cloneJson(save.state);
    firstState.attributes.authority = 61;
    const secondState = cloneJson(save.state);
    secondState.attributes.authority = 62;
    const results = await Promise.allSettled([
      saves.commit({
        saveId: save.saveId,
        profileId: save.profileId,
        expectedRevision: save.revision,
        nextState: firstState,
        updatedAt: "2026-09-15T12:00:00.000Z",
      }),
      concurrentSaves.commit({
        saveId: save.saveId,
        profileId: save.profileId,
        expectedRevision: save.revision,
        nextState: secondState,
        updatedAt: "2026-09-15T12:00:01.000Z",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toMatchObject({ code: "REVISION_CONFLICT" });
    }
    const loaded = await saves.load(save.saveId, save.profileId);
    expect(loaded?.revision).toBe(4);
    expect([61, 62]).toContain(loaded?.state.attributes.authority);
  });

  it("migrates a v1 row on load, preserves the raw row, and writes v2 on commit", async () => {
    const profiles = new SqliteProfileRepository(testDatabase.database);
    const saves = new SqliteSaveRepository(testDatabase.database);
    const legacy = cloneJson(saveV1Fixture) as RawSaveFixture;
    await profiles.create(makeProfile(legacy.profileId));
    await insertRawSave(testDatabase.database, legacy);

    const loaded = await saves.load(legacy.saveId, legacy.profileId);
    if (!loaded) throw new Error("expected the v1 fixture to load");
    expect(loaded.saveSchemaVersion).toBe(2);
    expect(loaded.state.cases["case-resolved"]).toMatchObject({
      status: "resolved",
      resolutionId: "warning",
      finalChoiceId: "formal-warning",
      snapshot: {
        resolvedAt: "2026-09-15T09:00:00.000Z",
        resolvedOrder: 1,
        attributeChanges: [{ attributeId: "restraint", before: 50, after: 53, actualDelta: 3 }],
      },
    });
    expect(JSON.stringify(loaded)).not.toMatch(
      /旧语言|caseTitle|finalChoiceText|verdict|result|"label"/u,
    );

    const rawBefore = await testDatabase.database.select<{
      revision: number;
      save_schema_version: number;
      state_json: string;
    }>("SELECT revision, save_schema_version, state_json FROM saves WHERE save_id = $1", [
      legacy.saveId,
    ]);
    expect(rawBefore[0]?.revision).toBe(7);
    expect(rawBefore[0]?.save_schema_version).toBe(1);
    expect(rawBefore[0]?.state_json).toBe(JSON.stringify(legacy.state));

    const nextState = cloneJson(loaded.state);
    nextState.attributes.authority = 49;
    await expect(
      saves.commit({
        saveId: legacy.saveId,
        profileId: legacy.profileId,
        expectedRevision: 7,
        nextState,
        updatedAt: "2026-09-15T12:00:00.000Z",
      }),
    ).resolves.toEqual({ revision: 8 });

    const rawAfter = await testDatabase.database.select<{
      revision: number;
      save_schema_version: number;
      state_json: string;
    }>("SELECT revision, save_schema_version, state_json FROM saves WHERE save_id = $1", [
      legacy.saveId,
    ]);
    expect(rawAfter[0]?.revision).toBe(8);
    expect(rawAfter[0]?.save_schema_version).toBe(2);
    expect(rawAfter[0]?.state_json).toBe(JSON.stringify(nextState));
  });

  it("rejects invalid or corrupt saves without overwriting the row", async () => {
    const profiles = new SqliteProfileRepository(testDatabase.database);
    const saves = new SqliteSaveRepository(testDatabase.database);
    const save = makeV2Save();
    await profiles.create(makeProfile(save.profileId));
    await saves.create(save);

    const invalidState = cloneJson(save.state);
    invalidState.attributes.authority = Number.NaN;
    await expect(
      saves.commit({
        saveId: save.saveId,
        profileId: save.profileId,
        expectedRevision: save.revision,
        nextState: invalidState,
        updatedAt: "2026-09-15T12:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "INVALID_SAVE" });
    await expect(saves.commit(null as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      saves.commit({
        saveId: save.saveId,
        profileId: save.profileId,
        expectedRevision: -1,
        nextState: save.state,
        updatedAt: "2026-09-15T12:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      saves.commit({
        saveId: save.saveId,
        profileId: save.profileId,
        expectedRevision: save.revision,
        nextState: save.state,
        updatedAt: "not-a-date",
      }),
    ).rejects.toMatchObject({ code: "INVALID_SAVE" });

    const failure = new Error("save transport failed");
    const failingSaves = new SqliteSaveRepository(
      withFailingExecute(testDatabase.database, failure),
    );
    await expect(
      failingSaves.commit({
        saveId: save.saveId,
        profileId: save.profileId,
        expectedRevision: save.revision,
        nextState: save.state,
        updatedAt: "2026-09-15T12:00:00.000Z",
      }),
    ).rejects.toBe(failure);
    await expect(failingSaves.create({ ...save, saveId: "unknown-write-save" })).rejects.toBe(
      failure,
    );

    const beforeCorruption = await testDatabase.database.select<{
      revision: number;
      state_json: string;
    }>("SELECT revision, state_json FROM saves WHERE save_id = $1", [save.saveId]);
    await testDatabase.database.execute("UPDATE saves SET state_json = $1 WHERE save_id = $2", [
      "{broken",
      save.saveId,
    ]);
    await expect(saves.load(save.saveId, save.profileId)).rejects.toMatchObject({
      code: "INVALID_SAVE",
    });
    const afterCorruption = await testDatabase.database.select<{
      revision: number;
      state_json: string;
    }>("SELECT revision, state_json FROM saves WHERE save_id = $1", [save.saveId]);
    expect(afterCorruption[0]?.revision).toBe(beforeCorruption[0]?.revision);
    expect(afterCorruption[0]?.state_json).toBe("{broken");
  });

  it("does not expose an unsupported future save schema as a valid snapshot", async () => {
    const profiles = new SqliteProfileRepository(testDatabase.database);
    const saves = new SqliteSaveRepository(testDatabase.database);
    const save = makeV2Save();
    await profiles.create(makeProfile(save.profileId));
    await saves.create(save);
    await testDatabase.database.execute(
      "UPDATE saves SET save_schema_version = $1 WHERE save_id = $2",
      [99, save.saveId],
    );

    await expect(saves.load(save.saveId, save.profileId)).rejects.toMatchObject({
      code: "INVALID_SAVE",
    });
    await expect(
      saves.commit({
        saveId: save.saveId,
        profileId: save.profileId,
        expectedRevision: save.revision,
        nextState: save.state,
        updatedAt: "2026-09-15T12:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "INVALID_SAVE" });
  });
});
