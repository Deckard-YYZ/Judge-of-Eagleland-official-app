import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopProfileEntry } from "../../src/app/desktopProfiles";
import { createMemoryProfileEntry } from "../../src/app/demoProfiles";
import { FakeSplitContentRepository } from "../../src/content/repository";
import { SqliteProfileRepository } from "../../src/storage/profileRepository";
import { SqliteSaveRepository } from "../../src/storage/sqliteSaveRepository";
import { SqliteSettingsRepository } from "../../src/storage/settingsRepository";
import { transition } from "../../src/game/transition";
import { mainFlowFixture } from "../fixtures/mainFlow";
import {
  createSqliteTestDatabase,
  type SqliteTestDatabase,
} from "../fixtures/storage/sqliteTestDatabase";
import type { ProfileEntryResult } from "../../src/application/profileEntry";

const databases: SqliteTestDatabase[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) await db.cleanup();
});
function entered(result: ProfileEntryResult) {
  if (!result.ok) throw new Error(result.error.message);
  return result;
}
async function desktop() {
  const db = createSqliteTestDatabase();
  databases.push(db);
  const fixture = mainFlowFixture();
  const repositories = {
    profiles: new SqliteProfileRepository(db.database),
    saves: new SqliteSaveRepository(db.database),
    settings: new SqliteSettingsRepository(db.database),
  };
  const options = {
    content: fixture.game,
    contentRepository: new FakeSplitContentRepository([
      { gameContent: fixture.game, localizations: fixture.localizations },
    ]),
  };
  return {
    db,
    repositories,
    options,
    entry: await createDesktopProfileEntry(repositories, options),
  };
}

describe("account tutorial first entry", () => {
  it("marks before showing and clears an interrupted tutorial on a fresh desktop entry", async () => {
    const { repositories, options, entry } = await desktop();
    const first = entered(await entry.register("First judge"));
    expect(first.session.getSnapshot().state!.pendingStoryIds).toContain("tutorial");
    expect(await repositories.profiles.getTutorialCompleted(first.profile.profileId)).toBe(true);
    const reopened = await createDesktopProfileEntry(repositories, options);
    const next = entered(await reopened.enter(first.profile.profileId));
    expect(next.session.getSnapshot().state!.pendingStoryIds).not.toContain("tutorial");
    expect(next.session.getSnapshot().state!.completedStoryIds).toContain("tutorial");
    expect(next.session.getSnapshot().state!.mainFlow).toEqual(
      first.session.getSnapshot().state!.mainFlow,
    );
  });

  it("does not expose a session if the account mark fails and recovers on next login", async () => {
    const { repositories, entry } = await desktop();
    vi.spyOn(repositories.profiles, "markTutorialCompleted").mockRejectedValueOnce(
      new Error("disk failure"),
    );
    expect(await entry.register("Retry judge")).toMatchObject({
      ok: false,
      error: { code: "LOAD_FAILED" },
    });
    const profileId = entry.getSnapshot().profiles[0].profileId;
    expect(await repositories.profiles.getTutorialCompleted(profileId)).toBe(false);
    const retry = entered(await entry.enter(profileId));
    expect(retry.session.getSnapshot().state!.pendingStoryIds).toContain("tutorial");
    expect(await repositories.profiles.getTutorialCompleted(profileId)).toBe(true);
  });

  it("keeps browser account completion across logout, including explicit early exit", async () => {
    const fixture = mainFlowFixture();
    const entry = createMemoryProfileEntry({
      gameContent: fixture.game,
      localizations: fixture.localizations,
      transition,
    });
    const first = entered(await entry.register("Browser judge"));
    expect(first.session.getSnapshot().state!.pendingStoryIds).toContain("tutorial");
    expect(
      await first.session.dispatch({ type: "dismissTutorial", storyId: "tutorial" }),
    ).toMatchObject({ ok: true });
    const next = entered(await entry.enter(first.profile.profileId));
    expect(next.session.getSnapshot().state!.pendingStoryIds).not.toContain("tutorial");
  });
});
