import { describe, expect, it } from "vitest";
import { InMemorySaveRepository } from "../../src/storage/inMemorySaveRepository";
import type { SaveEnvelope } from "../../src/game/model";

const createSave = (): SaveEnvelope => ({
  saveId: "save-1",
  profileId: "profile-1",
  revision: 0,
  saveSchemaVersion: 3,
  contentRef: {
    packageId: "minimal-test-package",
    version: "1.0.0",
  },
  createdAt: "2026-09-14T10:00:00.000Z",
  updatedAt: "2026-09-14T10:00:00.000Z",
  state: {
    phase: { type: "playing" },
    attributes: { restraint: 50, authority: 50 },
    flags: { first_case_closed: false },
    cases: {
      case_001: { status: "pending" },
    },
    pendingStoryIds: [],
    completedStoryIds: [],
    storyCheckpoint: null,
  },
});

describe("InMemorySaveRepository", () => {
  it("isolates create and load values from external mutation", async () => {
    const repository = new InMemorySaveRepository();
    const input = createSave();

    await repository.create(input);
    input.state.attributes.restraint = 1;

    const firstLoad = await repository.load("save-1", "profile-1");
    expect(firstLoad?.state.attributes.restraint).toBe(50);

    if (!firstLoad) {
      throw new Error("expected save to load");
    }
    firstLoad.state.attributes.restraint = 99;

    const secondLoad = await repository.load("save-1", "profile-1");
    expect(secondLoad?.state.attributes.restraint).toBe(50);
  });

  it("isolates profiles and rejects duplicate saves", async () => {
    const repository = new InMemorySaveRepository();
    await repository.create(createSave());

    await expect(repository.load("save-1", "profile-2")).resolves.toBeNull();
    await expect(repository.create(createSave())).rejects.toMatchObject({
      code: "SAVE_ALREADY_EXISTS",
    });
  });

  it("commits with CAS and rejects stale revisions without changing state", async () => {
    const repository = new InMemorySaveRepository([createSave()]);
    const nextState = createSave().state;
    nextState.attributes.restraint = 60;

    await expect(
      repository.commit({
        saveId: "save-1",
        profileId: "profile-1",
        expectedRevision: 0,
        nextState,
        updatedAt: "2026-09-14T10:01:00.000Z",
      }),
    ).resolves.toEqual({ revision: 1 });

    // Mutating the object after commit must not mutate the stored snapshot.
    nextState.attributes.restraint = 99;

    await expect(
      repository.commit({
        saveId: "save-1",
        profileId: "profile-1",
        expectedRevision: 0,
        nextState: createSave().state,
        updatedAt: "2026-09-14T10:02:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });

    const loaded = await repository.load("save-1", "profile-1");
    expect(loaded?.revision).toBe(1);
    expect(loaded?.state.attributes.restraint).toBe(60);
  });

  it("allows only one concurrent commit for the same expected revision", async () => {
    const repository = new InMemorySaveRepository([createSave()]);
    const firstState = createSave().state;
    firstState.attributes.restraint = 61;
    const secondState = createSave().state;
    secondState.attributes.restraint = 62;

    const results = await Promise.allSettled([
      repository.commit({
        saveId: "save-1",
        profileId: "profile-1",
        expectedRevision: 0,
        nextState: firstState,
        updatedAt: "2026-09-14T10:01:00.000Z",
      }),
      repository.commit({
        saveId: "save-1",
        profileId: "profile-1",
        expectedRevision: 0,
        nextState: secondState,
        updatedAt: "2026-09-14T10:01:01.000Z",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toMatchObject({ code: "REVISION_CONFLICT" });
    }

    const loaded = await repository.load("save-1", "profile-1");
    expect(loaded?.revision).toBe(1);
    expect([61, 62]).toContain(loaded?.state.attributes.restraint);
  });

  it("rejects invalid state without changing the stored revision or state", async () => {
    const repository = new InMemorySaveRepository([createSave()]);
    const invalidState = createSave().state;
    invalidState.attributes.restraint = Number.NaN;

    await expect(
      repository.commit({
        saveId: "save-1",
        profileId: "profile-1",
        expectedRevision: 0,
        nextState: invalidState,
        updatedAt: "2026-09-14T10:01:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "INVALID_SAVE" });

    const loaded = await repository.load("save-1", "profile-1");
    expect(loaded?.revision).toBe(0);
    expect(loaded?.state.attributes.restraint).toBe(50);
  });

  it("reports profile and missing-save errors on commit", async () => {
    const repository = new InMemorySaveRepository([createSave()]);
    const nextState = createSave().state;

    await expect(
      repository.commit({
        saveId: "save-1",
        profileId: "profile-2",
        expectedRevision: 0,
        nextState,
        updatedAt: "2026-09-14T10:01:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "PROFILE_MISMATCH" });

    await expect(
      repository.commit({
        saveId: "missing",
        profileId: "profile-1",
        expectedRevision: 0,
        nextState,
        updatedAt: "2026-09-14T10:01:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "SAVE_NOT_FOUND" });
  });
});
