import { createGameSession } from "../application/gameSession";
import { createGameSessionView } from "../application/gameSessionView";
import type {
  LocalProfileSummary,
  ProfileEntry,
  ProfileEntryError,
  ProfileEntryResult,
  ProfileEntrySnapshot,
} from "../application/profileEntry";
import { normalizeProfileDisplayName } from "../application/profileEntry";
import { ACTION_INPUT_GAME_CONTENT, ACTION_INPUT_LOCALIZATIONS } from "./actionInputContent";
import { FakeSplitContentRepository } from "../content/repository";
import { InMemorySaveRepository } from "../storage/inMemorySaveRepository";
import { createDemoSave } from "./demoSession";
import { demoTransition } from "./demoTransition";

interface DemoProfile extends LocalProfileSummary {
  readonly saveId: string;
}

/** In-memory Profile entry for frontend work. Refreshing the app resets all profiles. */
export const createDemoProfileEntry = (): ProfileEntry => {
  const content = ACTION_INPUT_GAME_CONTENT;
  const clock = () => new Date().toISOString();
  const initialProfile: DemoProfile = {
    profileId: "demo-profile",
    displayName: "演示档案员",
    saveId: "demo-save",
  };
  const profiles = new Map<string, DemoProfile>([[initialProfile.profileId, initialProfile]]);
  const saveRepository = new InMemorySaveRepository([
    createDemoSave(initialProfile.profileId, initialProfile.saveId, content, clock()),
  ]);
  const contentRepository = new FakeSplitContentRepository([
    { gameContent: content, localizations: ACTION_INPUT_LOCALIZATIONS },
  ]);
  const listeners = new Set<() => void>();
  let nextProfileNumber = 1;
  let busy = false;

  const summaries = (): readonly Readonly<LocalProfileSummary>[] =>
    Object.freeze(
      [...profiles.values()].map(({ profileId, displayName }) =>
        Object.freeze({ profileId, displayName }),
      ),
    );
  let snapshot: ProfileEntrySnapshot = Object.freeze({
    status: "ready",
    profiles: summaries(),
    error: null,
  });

  const publish = (
    status: ProfileEntrySnapshot["status"],
    error: ProfileEntryError | null,
  ): void => {
    snapshot = Object.freeze({
      status,
      profiles: summaries(),
      error: error && Object.freeze(error),
    });
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // Profile observers are presentation code and cannot change entry results.
      }
    }
  };

  const failure = (error: ProfileEntryError): ProfileEntryResult => {
    publish("ready", error);
    return Object.freeze({ ok: false, error: Object.freeze(error) });
  };

  const enterProfile = async (profile: DemoProfile): Promise<ProfileEntryResult> => {
    const session = createGameSession({
      saveRepository,
      contentRepository,
      transition: demoTransition,
      clock,
    });
    const sessionView = createGameSessionView(session, contentRepository);
    const loaded = await session.load(profile.saveId, profile.profileId);
    if (!loaded.ok) {
      return failure({ code: "LOAD_FAILED", message: loaded.message });
    }

    publish("ready", null);
    return Object.freeze({
      ok: true,
      profile: Object.freeze({ profileId: profile.profileId, displayName: profile.displayName }),
      session: sessionView,
    });
  };

  const runExclusive = async (
    operation: () => Promise<ProfileEntryResult>,
  ): Promise<ProfileEntryResult> => {
    // Acquire before the first await so double-submit cannot create two local profiles.
    if (busy) {
      return Object.freeze({
        ok: false,
        error: Object.freeze({
          code: "BUSY" as const,
          message: "另一项本地档案操作正在进行，请稍候。",
        }),
      });
    }
    busy = true;
    publish("working", null);
    try {
      return await operation();
    } finally {
      busy = false;
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    enter: (profileId) =>
      runExclusive(async () => {
        const profile = profiles.get(profileId);
        return profile
          ? enterProfile(profile)
          : failure({ code: "PROFILE_NOT_FOUND", message: "没有找到这个本地档案。" });
      }),
    register: (rawName) =>
      runExclusive(async () => {
        const displayName = normalizeProfileDisplayName(rawName);
        if (!displayName) {
          return failure({ code: "INVALID_NAME", message: "请输入本地档案显示名称。" });
        }
        const duplicate = [...profiles.values()].some(
          (profile) => profile.displayName.toLocaleLowerCase() === displayName.toLocaleLowerCase(),
        );
        if (duplicate) {
          return failure({ code: "PROFILE_EXISTS", message: "同名本地档案已经存在。" });
        }

        const sequence = nextProfileNumber++;
        const profile: DemoProfile = {
          profileId: `demo-profile-${sequence}`,
          displayName,
          saveId: `demo-save-${sequence}`,
        };
        await saveRepository.create(
          createDemoSave(profile.profileId, profile.saveId, content, clock()),
        );
        profiles.set(profile.profileId, profile);
        return enterProfile(profile);
      }),
  };
};
