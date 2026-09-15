import { describe, expect, it } from "vitest";
import type { SaveEnvelope } from "../../src/game/model";
import { InMemorySaveRepository } from "../../src/storage/inMemorySaveRepository";
import { exportSaveBackup, importSaveBackup } from "../../src/storage/saveBackup";

const fixture = (): SaveEnvelope => ({
  saveId: "source",
  profileId: "profile-a",
  revision: 3,
  saveSchemaVersion: 2,
  contentRef: { packageId: "storage-fixture", version: "1.0.0" },
  createdAt: "2026-09-15T10:00:00.000Z",
  updatedAt: "2026-09-15T11:00:00.000Z",
  state: {
    phase: { type: "playing" },
    attributes: { authority: 50 },
    flags: {},
    cases: { case_a: { status: "active", currentNodeId: "review", history: [] } },
    pendingStoryIds: ["story-a"],
    completedStoryIds: [],
  },
});

const destination = {
  saveId: "imported-copy",
  profileId: "profile-b",
  importedAt: "2026-09-15T12:00:00.000Z",
};

describe("save JSON backup", () => {
  it("exports committed data and restores an independent copy with the exact content version", async () => {
    const original = fixture();
    const repository = new InMemorySaveRepository([original]);
    const json = await exportSaveBackup(repository, original.saveId, original.profileId);
    expect(JSON.parse(json)).toEqual(original);
    const imported = await importSaveBackup(repository, json, destination);
    expect(imported).toEqual({
      ...original,
      saveId: destination.saveId,
      profileId: destination.profileId,
      revision: 0,
      updatedAt: destination.importedAt,
    });
    expect(await repository.load(original.saveId, original.profileId)).toEqual(original);
    expect(await repository.load(destination.saveId, destination.profileId)).toEqual(imported);
  });

  it("rejects an existing destination without replacing its revision or state", async () => {
    const original = fixture();
    const repository = new InMemorySaveRepository([original]);
    const modified = fixture();
    modified.state.attributes.authority = 99;
    await expect(
      importSaveBackup(repository, JSON.stringify(modified), {
        ...destination,
        saveId: original.saveId,
        profileId: original.profileId,
      }),
    ).rejects.toMatchObject({ code: "SAVE_ALREADY_EXISTS" });
    expect(await repository.load(original.saveId, original.profileId)).toEqual(original);
  });

  it.each(["{broken", "null", JSON.stringify({ ...fixture(), saveSchemaVersion: 99 })])(
    "rejects malformed or unsupported backup data before writing: %s",
    async (json) => {
      const repository = new InMemorySaveRepository();
      await expect(importSaveBackup(repository, json, destination)).rejects.toMatchObject({
        code: "INVALID_SAVE",
      });
      expect(await repository.load(destination.saveId, destination.profileId)).toBeNull();
    },
  );

  it("does not export another Profile's snapshot", async () => {
    const repository = new InMemorySaveRepository([fixture()]);
    await expect(exportSaveBackup(repository, "source", "profile-b")).rejects.toMatchObject({
      code: "SAVE_NOT_FOUND",
    });
  });
});
