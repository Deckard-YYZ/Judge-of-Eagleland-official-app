import { getDiagnostics } from "../shared/diagnostics";
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
import {
  BundledSplitContentRepository,
  DEFAULT_BUNDLED_CONTENT_REF,
} from "../content/bundledRepository";
import type { SplitContentRepository } from "../content/repository";
import type { GameContentCatalog } from "../content/schema";
import type { Transition } from "../game/commands";
import { createInitialGameState } from "../game/initialization";
import type { SaveEnvelope } from "../game/model";
import { normalizeProfileLoginName, type ProfileRecord } from "../storage/profileRepository";
import type { SaveRepository } from "../storage/saveRepository";
import type { StorageRepositories } from "../storage";
import { transition as gameTransition } from "../game/transition";
import { configureInitialTutorial } from "./tutorialPolicy";

/** Profile-scoped setting used to select a save when a profile has more than one. */
export const CURRENT_SAVE_ID_SETTING_KEY = "currentSaveId";

export const profileSettingsScope = (profileId: string): `profile:${string}` =>
  `profile:${profileId}`;

/**
 * The first desktop save has a deterministic ID. A retry after an uncertain
 * insert can therefore discover the same row instead of creating a second run.
 */
export const defaultSaveIdForProfile = (profileId: string): string => `save:${profileId}:default`;

export interface DesktopStorageRepositories extends Pick<
  StorageRepositories,
  "profiles" | "saves" | "settings"
> {}

export interface DesktopProfileEntryOptions {
  /** A clock shared by profile records, initial saves, and GameSession. */
  clock?: () => string;
  /** Injectable for deterministic tests; production uses a cryptographically random ID. */
  createProfileId?: (loginName: string) => string;
  /** Injectable so tests can exercise a stable retry ID without changing production policy. */
  createSaveId?: (profileId: string) => string;
  content?: Readonly<GameContentCatalog>;
  contentRepository?: SplitContentRepository;
  transition?: Transition;
  /** Temporary launch policy; tutorial content remains installed for later re-enabling. */
  tutorialEnabled?: boolean;
}

type ListableSaveRepository = SaveRepository & {
  /** Added by the storage line to resolve the no-pointer and multi-save cases safely. */
  listByProfile?: (profileId: string) => Promise<readonly unknown[]>;
};

type DesktopProfile = Readonly<LocalProfileSummary & { loginName: string }>;

class DesktopProfileOperationError extends Error {
  readonly code: "SAVE_SELECTION_REQUIRED" | "SAVE_LIST_UNAVAILABLE" | "SAVE_POINTER_INVALID";

  constructor(
    code: "SAVE_SELECTION_REQUIRED" | "SAVE_LIST_UNAVAILABLE" | "SAVE_POINTER_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "DesktopProfileOperationError";
    this.code = code;
  }
}

const defaultClock = (): string => new Date().toISOString();

const defaultProfileId = (): string => {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid === "function") {
    return `profile-${randomUuid.call(globalThis.crypto)}`;
  }

  // This branch is for older WebViews and test environments. The persisted ID
  // remains stable after creation; only its initial value needs uniqueness.
  return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const describeError = (error: unknown, fallback: string): string => {
  getDiagnostics().record({
    source: "profiles",
    event: "profile.operation_failed",
    level: "error",
    data: { phase: fallback },
    error,
  });
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
};

const makeFailure = (code: ProfileEntryError["code"], message: string): ProfileEntryResult =>
  Object.freeze({
    ok: false as const,
    error: Object.freeze({ code, message }),
  });

const profileSummary = (profile: ProfileRecord): DesktopProfile =>
  Object.freeze({
    profileId: profile.profileId,
    loginName: profile.loginName,
    displayName: profile.displayName,
  });

const saveIdFromListEntry = (entry: unknown): string | null => {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  if (typeof record.saveId === "string" && record.saveId.length > 0) return record.saveId;
  // Accept a storage summary using the SQL column spelling as well. The
  // production repository returns camelCase envelopes, but this keeps the
  // composition boundary tolerant of a summary-only list implementation.
  if (typeof record.save_id === "string" && record.save_id.length > 0) return record.save_id;
  return null;
};

const createInitialSave = (
  profileId: string,
  saveId: string,
  content: Readonly<GameContentCatalog>,
  now: string,
): SaveEnvelope => {
  const initial = createInitialGameState(content);
  if (!initial.ok) {
    const detail = initial.issues
      .map((issue) => `${issue.code} at ${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Cannot create an initial save from the bundled content: ${detail}`);
  }

  return {
    saveId,
    profileId,
    revision: 0,
    saveSchemaVersion: 3,
    contentRef: {
      packageId: content.manifest.packageId,
      version: content.manifest.version,
    },
    createdAt: now,
    updatedAt: now,
    state: initial.state,
  };
};

/**
 * Compose ProfileEntry over the production repositories. The factory reads
 * profiles before returning so the first rendered list is backed by SQLite.
 * It does not catch initialization failures: bootstrap must keep those visible
 * and must never replace this entry with an in-memory implementation.
 */
export async function createDesktopProfileEntry(
  repositories: DesktopStorageRepositories,
  options: DesktopProfileEntryOptions = {},
): Promise<ProfileEntry> {
  const clock = options.clock ?? defaultClock;
  const contentRepository = options.contentRepository ?? new BundledSplitContentRepository();
  // Bootstrap must fail visibly if installed content is missing or invalid.
  const loadedContent =
    options.content ?? (await contentRepository.loadGameContent(DEFAULT_BUNDLED_CONTENT_REF));
  const content = configureInitialTutorial(loadedContent, options.tutorialEnabled ?? true);
  const transition = options.transition ?? gameTransition;
  const makeProfileId = options.createProfileId ?? (() => defaultProfileId());
  const makeSaveId = options.createSaveId ?? defaultSaveIdForProfile;
  const saveRepository = repositories.saves as ListableSaveRepository;

  const initialRecords = await repositories.profiles.list();
  const profiles = new Map<string, DesktopProfile>();
  for (const profile of initialRecords) {
    profiles.set(profile.profileId, profileSummary(profile));
  }

  // This set only records a known incomplete two-call registration in this
  // entry instance. The persistent state remains authoritative on restart.
  const profilesAwaitingSave = new Set<string>();
  const listeners = new Set<() => void>();
  let busy = false;
  let nextSnapshot: ProfileEntrySnapshot = Object.freeze({
    status: "ready",
    profiles: Object.freeze(
      [...profiles.values()].map(({ profileId, displayName }) =>
        Object.freeze({ profileId, displayName }),
      ),
    ),
    error: null,
  });

  const publish = (
    status: ProfileEntrySnapshot["status"],
    error: ProfileEntryError | null,
  ): void => {
    nextSnapshot = Object.freeze({
      status,
      profiles: Object.freeze(
        [...profiles.values()].map(({ profileId, displayName }) =>
          Object.freeze({ profileId, displayName }),
        ),
      ),
      error: error ? Object.freeze(error) : null,
    });
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        getDiagnostics().record({
          source: "profiles",
          event: "profile.subscriber_failed",
          level: "error",
          error,
        });
        // Presentation subscribers cannot change repository facts or results.
      }
    }
  };

  const failure = (message: string): ProfileEntryResult => {
    publish("ready", { code: "LOAD_FAILED", message });
    return makeFailure("LOAD_FAILED", message);
  };

  const withExclusive = async (
    operation: () => Promise<ProfileEntryResult>,
  ): Promise<ProfileEntryResult> => {
    if (busy) return makeFailure("BUSY", "Another local profile operation is in progress.");
    busy = true;
    publish("working", null);
    try {
      return await operation();
    } finally {
      busy = false;
    }
  };

  const updateProfileFromRepository = async (profileId: string): Promise<DesktopProfile | null> => {
    const record = await repositories.profiles.get(profileId);
    if (!record) {
      profiles.delete(profileId);
      return null;
    }
    const current = profileSummary(record);
    profiles.set(profileId, current);
    return current;
  };

  const listSaveIds = async (profileId: string): Promise<readonly string[]> => {
    const listByProfile = saveRepository.listByProfile;
    if (typeof listByProfile !== "function") {
      throw new DesktopProfileOperationError(
        "SAVE_LIST_UNAVAILABLE",
        "The current save cannot be selected because the storage adapter cannot list profile saves.",
      );
    }

    const entries = await listByProfile.call(saveRepository, profileId);
    const ids: string[] = [];
    for (const entry of entries) {
      const saveId = saveIdFromListEntry(entry);
      if (!saveId || ids.includes(saveId)) {
        throw new DesktopProfileOperationError(
          "SAVE_SELECTION_REQUIRED",
          "The profile save list is invalid or contains duplicate save IDs.",
        );
      }
      ids.push(saveId);
    }
    return ids;
  };

  const readCurrentSaveId = async (profile: DesktopProfile): Promise<string | null> => {
    const value = await repositories.settings.get(
      profileSettingsScope(profile.profileId),
      CURRENT_SAVE_ID_SETTING_KEY,
    );
    if (value === null) return null;
    if (typeof value !== "string" || value.length === 0) {
      throw new DesktopProfileOperationError(
        "SAVE_POINTER_INVALID",
        "The current save setting is invalid; choose a save explicitly before continuing.",
      );
    }
    return value;
  };

  const resolveCurrentSaveId = async (profile: DesktopProfile): Promise<string | null> => {
    const pointedSaveId = await readCurrentSaveId(profile);
    if (pointedSaveId !== null) {
      const pointedSave = await repositories.saves.load(pointedSaveId, profile.profileId);
      if (!pointedSave) {
        throw new DesktopProfileOperationError(
          "SAVE_SELECTION_REQUIRED",
          `The configured current save "${pointedSaveId}" was not found for this profile.`,
        );
      }
      return pointedSave.saveId;
    }

    const ids = await listSaveIds(profile.profileId);
    if (ids.length === 0) return null;
    if (ids.length > 1) {
      throw new DesktopProfileOperationError(
        "SAVE_SELECTION_REQUIRED",
        "This profile has multiple saves but no current save selection.",
      );
    }

    // Loading the sole candidate validates its JSON and schema before the
    // pointer is repaired. A corrupt row is never replaced by a new game.
    const onlySave = await repositories.saves.load(ids[0], profile.profileId);
    if (!onlySave) {
      throw new DesktopProfileOperationError(
        "SAVE_SELECTION_REQUIRED",
        `The only listed save "${ids[0]}" was not found for this profile.`,
      );
    }
    await repositories.settings.set(
      profileSettingsScope(profile.profileId),
      CURRENT_SAVE_ID_SETTING_KEY,
      onlySave.saveId,
    );
    return onlySave.saveId;
  };

  const createOrRecoverInitialSave = async (profile: DesktopProfile): Promise<string> => {
    const saveId = makeSaveId(profile.profileId);
    if (typeof saveId !== "string" || saveId.length === 0) {
      throw new Error("The initial save ID generator returned an empty ID.");
    }

    const now = clock();
    const save = createInitialSave(profile.profileId, saveId, content, now);
    try {
      await repositories.saves.create(save);
    } catch (error) {
      // A duplicate fixed ID is an unambiguous result. Read it back and verify
      // ownership; an unknown write error remains an error for the caller.
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "SAVE_ALREADY_EXISTS"
      ) {
        const existing = await repositories.saves.load(saveId, profile.profileId);
        if (!existing) throw error;
      } else {
        throw error;
      }
    }

    await repositories.settings.set(
      profileSettingsScope(profile.profileId),
      CURRENT_SAVE_ID_SETTING_KEY,
      saveId,
    );
    return saveId;
  };

  const openProfile = async (
    profile: DesktopProfile,
    allowDirectCreate: boolean,
  ): Promise<ProfileEntryResult> => {
    let saveId: string | null;
    try {
      saveId = await resolveCurrentSaveId(profile);
    } catch (error) {
      if (
        allowDirectCreate &&
        error instanceof DesktopProfileOperationError &&
        error.code === "SAVE_LIST_UNAVAILABLE"
      ) {
        try {
          saveId = await createOrRecoverInitialSave(profile);
        } catch (createError) {
          profilesAwaitingSave.add(profile.profileId);
          return failure(
            describeError(
              createError,
              "The profile was created, but its initial save could not be written.",
            ),
          );
        }
      } else {
        return failure(describeError(error, "The current save could not be selected."));
      }
    }

    if (saveId === null) {
      try {
        saveId = await createOrRecoverInitialSave(profile);
      } catch (error) {
        profilesAwaitingSave.add(profile.profileId);
        return failure(
          describeError(
            error,
            "The profile has no save, and its initial save could not be written.",
          ),
        );
      }
    }

    const session = createGameSession({
      saveRepository: repositories.saves,
      contentRepository,
      transition,
      clock,
    });
    const sessionView = createGameSessionView(session, contentRepository);
    const loaded = await session.load(saveId, profile.profileId);
    if (!loaded.ok) {
      return failure(loaded.message);
    }

    profilesAwaitingSave.delete(profile.profileId);
    publish("ready", null);
    return Object.freeze({
      ok: true as const,
      profile: Object.freeze({ profileId: profile.profileId, displayName: profile.displayName }),
      session: sessionView,
    });
  };

  const enter = (profileId: string): Promise<ProfileEntryResult> =>
    withExclusive(async () => {
      let profile: DesktopProfile | null;
      try {
        profile = await updateProfileFromRepository(profileId);
      } catch (error) {
        return failure(describeError(error, "The local profile could not be read."));
      }
      if (!profile) {
        return failure("The requested local profile was not found.");
      }
      return openProfile(profile, profilesAwaitingSave.has(profile.profileId));
    });

  const register = (rawName: string): Promise<ProfileEntryResult> =>
    withExclusive(async () => {
      const displayName = normalizeProfileDisplayName(rawName);
      if (!displayName) {
        publish("ready", { code: "INVALID_NAME", message: "Enter a local profile display name." });
        return makeFailure("INVALID_NAME", "Enter a local profile display name.");
      }
      // loginName and displayName intentionally share the same whitespace rule.
      // Case is preserved because ProfileRepository compares loginName exactly.
      const loginName = normalizeProfileLoginName(displayName);

      let existing: ProfileRecord | null;
      try {
        existing = await repositories.profiles.findByLoginName(loginName);
      } catch (error) {
        return failure(describeError(error, "The local profile could not be checked."));
      }

      if (existing) {
        const profile = profileSummary(existing);
        profiles.set(profile.profileId, profile);
        if (profilesAwaitingSave.has(profile.profileId)) {
          return openProfile(profile, true);
        }
        publish("ready", {
          code: "PROFILE_EXISTS",
          message: "A local profile with this name already exists.",
        });
        return makeFailure("PROFILE_EXISTS", "A local profile with this name already exists.");
      }

      let profile: DesktopProfile;
      try {
        const profileId = makeProfileId(loginName);
        if (typeof profileId !== "string" || profileId.length === 0) {
          throw new Error("The profile ID generator returned an empty ID.");
        }
        const record: ProfileRecord = {
          profileId,
          loginName,
          displayName,
          createdAt: clock(),
        };
        await repositories.profiles.create(record);
        profile = profileSummary(record);
        profiles.set(profile.profileId, profile);
        publish("working", null);
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "PROFILE_ALREADY_EXISTS"
        ) {
          try {
            const concurrent = await repositories.profiles.findByLoginName(loginName);
            if (concurrent) {
              const profile = profileSummary(concurrent);
              profiles.set(profile.profileId, profile);
              publish("ready", {
                code: "PROFILE_EXISTS",
                message: "A local profile with this name already exists.",
              });
              return makeFailure(
                "PROFILE_EXISTS",
                "A local profile with this name already exists.",
              );
            }
          } catch (lookupError) {
            return failure(
              describeError(
                lookupError,
                "The local profile could not be checked after a conflict.",
              ),
            );
          }
        }
        return failure(describeError(error, "The local profile could not be created."));
      }

      // Profile and save creation are deliberately separate repository calls.
      // If the second call fails, the profile stays visible and the next retry
      // uses the same profile/save IDs to recover without overwriting anything.
      return openProfile(profile, true);
    });

  return {
    getSnapshot: () => nextSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    enter,
    register,
  };
}
