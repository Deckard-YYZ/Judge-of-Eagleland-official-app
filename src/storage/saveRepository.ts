import {
  GameStateSchema,
  SaveEnvelopeSchema,
  type GameState,
  type SaveEnvelope,
} from "../game/model";
import { migrateStoredSaveEnvelope } from "./migrateSave";

/** 输入版本条件写入时使用的参数，和数据库 UPDATE 的条件完全对应。 */
export interface SaveCommitInput {
  saveId: string;
  profileId: string;
  expectedRevision: number;
  nextState: GameState;
  updatedAt: string;
}

export interface SaveCommitResult {
  revision: number;
}

/**
 * 存档实现统一使用这些可检查错误码，调用方可以据此区分重试、重新读档和提示。
 * load 对未知存档和非所属 Profile 统一返回 null，避免暴露其他 Profile 的存档存在性；
 * commit 则必须明确报告归属和 revision 冲突。
 * 这些已知错误表示本次写入未提交。实现无法确认提交结果时必须抛出其他异常，
 * 由会话进入 needsReload 核对，不能把不确定写入伪装为可直接重试的已知错误。
 */
export type SaveRepositoryErrorCode =
  | "INVALID_INPUT"
  | "INVALID_SAVE"
  | "SAVE_ALREADY_EXISTS"
  | "SAVE_NOT_FOUND"
  | "PROFILE_MISMATCH"
  | "REVISION_CONFLICT";

export class SaveRepositoryError extends Error {
  readonly code: SaveRepositoryErrorCode;
  readonly cause?: unknown;

  constructor(code: SaveRepositoryErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "SaveRepositoryError";
    this.code = code;
    this.cause = cause;
  }
}

export const isSaveRepositoryError = (error: unknown): error is SaveRepositoryError =>
  error instanceof SaveRepositoryError;

/**
 * 存档是整局状态的唯一持久化入口。实现必须让 commit 的 revision 条件与更新原子对应。
 */
export interface SaveRepository {
  load(saveId: string, profileId: string): Promise<SaveEnvelope | null>;
  /** List only rows owned by this Profile; corrupt rows fail closed. */
  listByProfile?(profileId: string): Promise<readonly SaveEnvelope[]>;
  create(save: SaveEnvelope): Promise<void>;
  commit(input: SaveCommitInput): Promise<SaveCommitResult>;
}

/** 在 repository 边界把外部值解析成合法 GameState，并将 Schema 错误归一化。 */
export const parseGameStateForStorage = (value: unknown): GameState => {
  try {
    return GameStateSchema.parse(value);
  } catch (error) {
    throw new SaveRepositoryError(
      "INVALID_SAVE",
      "The supplied game state does not satisfy the save contract.",
      error,
    );
  }
};

/** 在 repository 边界把外部值解析成合法 SaveEnvelope。 */
export const parseSaveEnvelopeForStorage = (value: unknown): SaveEnvelope => {
  try {
    return SaveEnvelopeSchema.parse(value);
  } catch (error) {
    throw new SaveRepositoryError(
      "INVALID_SAVE",
      "The supplied save envelope does not satisfy the save contract.",
      error,
    );
  }
};

/** Persisted rows may be v1; migration is confined to this read boundary. */
export const parseStoredSaveEnvelope = (value: unknown): SaveEnvelope => {
  try {
    return migrateStoredSaveEnvelope(value);
  } catch (error) {
    throw new SaveRepositoryError("INVALID_SAVE", "The stored save cannot be migrated.", error);
  }
};
