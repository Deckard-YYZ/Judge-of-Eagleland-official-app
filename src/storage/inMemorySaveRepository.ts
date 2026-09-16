import { SaveEnvelopeSchema, type SaveEnvelope } from "../game/model";
import {
  SaveRepositoryError,
  type SaveCommitInput,
  type SaveCommitResult,
  type SaveRepository,
  parseGameStateForStorage,
  parseSaveEnvelopeForStorage,
  parseStoredSaveEnvelope,
} from "./saveRepository";

/**
 * GameState 和 SaveEnvelope 都是 JSON-safe 数据。通过 JSON round-trip 做深复制，
 * 让 fake 的读写语义和 SQLite JSON 持久化一致，同时隔离调用方的可变对象引用。
 */
const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cloneSave = (save: SaveEnvelope): SaveEnvelope => SaveEnvelopeSchema.parse(cloneJson(save));

const validateIdentity = (value: string, field: string): void => {
  if (typeof value !== "string" || value.length === 0) {
    throw new SaveRepositoryError("INVALID_INPUT", `${field} must be a non-empty string.`);
  }
};

const validateRevision = (revision: number): void => {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new SaveRepositoryError(
      "INVALID_INPUT",
      "expectedRevision must be a non-negative safe integer.",
    );
  }
};

/**
 * 不依赖 SQLite 的完整存档替身，供 UI/Application 在正式存储接入前联调。
 * commit 在第一次异步边界之前完成校验、CAS 检查和 Map 写入，保持单线程内原子。
 */
export class InMemorySaveRepository implements SaveRepository {
  private readonly saves = new Map<string, SaveEnvelope>();

  constructor(initialSaves: readonly unknown[] = []) {
    for (const save of initialSaves) {
      const parsed = parseStoredSaveEnvelope(save);
      if (this.saves.has(parsed.saveId)) {
        throw new SaveRepositoryError(
          "SAVE_ALREADY_EXISTS",
          `A save with id "${parsed.saveId}" already exists.`,
        );
      }

      this.saves.set(parsed.saveId, cloneSave(parsed));
    }
  }

  async load(saveId: string, profileId: string): Promise<SaveEnvelope | null> {
    validateIdentity(saveId, "saveId");
    validateIdentity(profileId, "profileId");

    const stored = this.saves.get(saveId);
    if (!stored || stored.profileId !== profileId) {
      return null;
    }

    return cloneSave(stored);
  }

  async create(save: SaveEnvelope): Promise<void> {
    const parsed = parseSaveEnvelopeForStorage(save);
    if (this.saves.has(parsed.saveId)) {
      throw new SaveRepositoryError(
        "SAVE_ALREADY_EXISTS",
        `A save with id "${parsed.saveId}" already exists.`,
      );
    }

    this.saves.set(parsed.saveId, cloneSave(parsed));
  }

  async commit(input: SaveCommitInput): Promise<SaveCommitResult> {
    const { saveId, profileId, expectedRevision, nextState, updatedAt } = input;
    validateIdentity(saveId, "saveId");
    validateIdentity(profileId, "profileId");
    validateIdentity(updatedAt, "updatedAt");
    validateRevision(expectedRevision);

    // Parse and clone before touching the stored value. Invalid input cannot partially commit.
    const parsedState = parseGameStateForStorage(nextState);
    const parsedNextState = parseGameStateForStorage(cloneJson(parsedState));
    const stored = this.saves.get(saveId);

    if (!stored) {
      throw new SaveRepositoryError("SAVE_NOT_FOUND", `Save "${saveId}" does not exist.`);
    }

    if (stored.profileId !== profileId) {
      throw new SaveRepositoryError(
        "PROFILE_MISMATCH",
        `Save "${saveId}" does not belong to profile "${profileId}".`,
      );
    }

    if (stored.revision !== expectedRevision) {
      throw new SaveRepositoryError(
        "REVISION_CONFLICT",
        `Save "${saveId}" is at revision ${stored.revision}; expected ${expectedRevision}.`,
      );
    }

    const nextRevision = stored.revision + 1;
    const nextEnvelope = parseSaveEnvelopeForStorage({
      ...stored,
      revision: nextRevision,
      updatedAt,
      state: parsedNextState,
    });

    // No await occurs between the revision check and this write.
    this.saves.set(saveId, cloneSave(nextEnvelope));
    return { revision: nextRevision };
  }
}
