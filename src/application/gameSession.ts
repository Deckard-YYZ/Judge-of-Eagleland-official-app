import { ContentCatalogSchema, type ContentCatalog } from "../content/schema";
import type { ContentRepository } from "../content/repository";
import {
  GameCommandSchema,
  TransitionContextSchema,
  TransitionResultSchema,
  type FeedbackRequest,
  type GameCommand,
  type Transition,
  type TransitionErrorCode,
} from "../game/commands";
import {
  GameStateSchema,
  SaveEnvelopeSchema,
  type GameState,
  type SaveEnvelope,
} from "../game/model";
import {
  isSaveRepositoryError,
  type SaveRepository,
  type SaveRepositoryErrorCode,
} from "../storage/saveRepository";
import type { ZodError } from "zod";

/** 会话时钟在规则计算和一次存档提交中提供同一个时间值。 */
export type GameSessionClock = () => string;

export type GameSessionErrorCode =
  | "BUSY"
  | "NOT_LOADED"
  | "RELOAD_REQUIRED"
  | "INVALID_COMMAND"
  | "TRANSITION_ERROR"
  | "CLOCK_ERROR"
  | "SAVE_NOT_FOUND"
  | "SAVE_LOAD_FAILED"
  | "INVALID_SAVE"
  | "CONTENT_LOAD_FAILED"
  | "CONTENT_INVALID"
  | "CONTENT_MISMATCH"
  | "SAVE_FAILED"
  | TransitionErrorCode
  | SaveRepositoryErrorCode;

/** 对 UI 足够明确、且不暴露底层异常实现的可判别错误。 */
export interface GameSessionError {
  readonly code: GameSessionErrorCode;
  readonly message: string;
}

export type GameSessionIdleSnapshot = Readonly<{
  status: "idle";
  envelope: null;
  state: null;
  content: null;
  error: null;
}>;

export type GameSessionLoadingSnapshot = Readonly<{
  status: "loading";
  envelope: null;
  state: null;
  content: null;
  error: null;
}>;

export type GameSessionReadySnapshot = Readonly<{
  status: "ready";
  envelope: Readonly<SaveEnvelope>;
  state: Readonly<GameState>;
  content: Readonly<ContentCatalog>;
  error: null;
}>;

export type GameSessionSavingSnapshot = Readonly<{
  status: "saving";
  envelope: Readonly<SaveEnvelope>;
  state: Readonly<GameState>;
  content: Readonly<ContentCatalog>;
  error: null;
}>;

export type GameSessionNeedsReloadSnapshot = Readonly<{
  status: "needsReload";
  envelope: Readonly<SaveEnvelope>;
  state: Readonly<GameState>;
  content: Readonly<ContentCatalog>;
  error: Readonly<GameSessionError>;
}>;

export type GameSessionErrorSnapshot = Readonly<{
  status: "error";
  envelope: null;
  state: null;
  content: null;
  error: Readonly<GameSessionError>;
}>;

/** useSyncExternalStore 可直接消费的稳定快照。 */
export type GameSessionSnapshot =
  | GameSessionIdleSnapshot
  | GameSessionLoadingSnapshot
  | GameSessionReadySnapshot
  | GameSessionSavingSnapshot
  | GameSessionNeedsReloadSnapshot
  | GameSessionErrorSnapshot;

export type GameSessionFailure = Readonly<{
  ok: false;
  code: GameSessionErrorCode;
  message: string;
}>;

export type GameSessionLoadSuccess = Readonly<{
  ok: true;
  snapshot: GameSessionReadySnapshot;
}>;

export type GameSessionLoadResult = GameSessionLoadSuccess | GameSessionFailure;

export type GameSessionDispatchSuccess = Readonly<{
  ok: true;
  snapshot: GameSessionReadySnapshot;
  feedback: readonly FeedbackRequest[];
}>;

export type GameSessionDispatchResult = GameSessionDispatchSuccess | GameSessionFailure;

export interface GameSessionDependencies {
  readonly saveRepository: SaveRepository;
  readonly contentRepository: ContentRepository;
  readonly transition: Transition;
  readonly clock: GameSessionClock;
}

export interface GameSession {
  /** 读取一个已存在的存档，并按其 contentRef 加载精确内容版本。 */
  load(saveId: string, profileId: string): Promise<GameSessionLoadResult>;

  /** 对当前已提交状态执行一次规则计算和条件版本提交。 */
  dispatch(command: GameCommand): Promise<GameSessionDispatchResult>;

  /** 返回同一版本的同一快照对象；发布新版本前不会创建新对象。 */
  getSnapshot(): GameSessionSnapshot;

  /** 订阅已提交会话快照变更，返回取消订阅函数。 */
  subscribe(listener: () => void): () => void;

  /** 订阅保存成功后产生的临时反馈，不参与存档恢复。 */
  subscribeFeedback(listener: (feedback: readonly FeedbackRequest[]) => void): () => void;
}

/**
 * 状态和内容都是 JSON-safe Schema 值，因此递归冻结足以阻止 UI 或规则意外
 * 修改会话内部引用。递归集合用于兼容测试替身传入的重复引用。
 */
const deepFreeze = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (value === null || typeof value !== "object") {
    return value;
  }

  const objectValue = value as object;
  if (seen.has(objectValue)) {
    return value;
  }

  seen.add(objectValue);
  for (const child of Object.values(objectValue)) {
    deepFreeze(child, seen);
  }

  return Object.freeze(value);
};

const freezeError = (error: GameSessionError): Readonly<GameSessionError> =>
  Object.freeze({ ...error });

const createError = (code: GameSessionErrorCode, message: string): GameSessionError => ({
  code,
  message,
});

const failure = (error: GameSessionError): GameSessionFailure => {
  const frozenError = freezeError(error);
  return Object.freeze({
    ok: false as const,
    code: frozenError.code,
    message: frozenError.message,
  });
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return fallback;
};

const zodMessage = (error: unknown, fallback: string): string =>
  error && typeof error === "object" && "issues" in error
    ? `${fallback} (${(error as ZodError).issues.length} schema issue(s)).`
    : fallback;

const freezeEnvelope = (value: SaveEnvelope): Readonly<SaveEnvelope> => {
  const parsed = SaveEnvelopeSchema.parse(value);
  return deepFreeze(parsed) as Readonly<SaveEnvelope>;
};

const freezeContent = (value: ContentCatalog): Readonly<ContentCatalog> => {
  const parsed = ContentCatalogSchema.parse(value);
  return deepFreeze(parsed) as Readonly<ContentCatalog>;
};

const emptySnapshot = (): GameSessionIdleSnapshot =>
  Object.freeze({
    status: "idle" as const,
    envelope: null,
    state: null,
    content: null,
    error: null,
  });

const readySnapshot = (
  envelope: Readonly<SaveEnvelope>,
  content: Readonly<ContentCatalog>,
): GameSessionReadySnapshot =>
  Object.freeze({
    status: "ready" as const,
    envelope,
    state: envelope.state,
    content,
    error: null,
  });

const loadingSnapshot = (): GameSessionLoadingSnapshot =>
  Object.freeze({
    status: "loading" as const,
    envelope: null,
    state: null,
    content: null,
    error: null,
  });

const savingSnapshot = (snapshot: GameSessionReadySnapshot): GameSessionSavingSnapshot =>
  Object.freeze({
    status: "saving" as const,
    envelope: snapshot.envelope,
    state: snapshot.state,
    content: snapshot.content,
    error: null,
  });

const needsReloadSnapshot = (
  snapshot: GameSessionReadySnapshot | GameSessionSavingSnapshot | GameSessionNeedsReloadSnapshot,
  error: GameSessionError,
): GameSessionNeedsReloadSnapshot =>
  Object.freeze({
    status: "needsReload" as const,
    envelope: snapshot.envelope,
    state: snapshot.state,
    content: snapshot.content,
    error: freezeError(error),
  });

const errorSnapshot = (error: GameSessionError): GameSessionErrorSnapshot =>
  Object.freeze({
    status: "error" as const,
    envelope: null,
    state: null,
    content: null,
    error: freezeError(error),
  });

const isSafeRevision = (revision: unknown): revision is number =>
  typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0;

/**
 * 创建一个只处理“加载已有存档 → 纯规则计算 → 条件提交 → 发布”的最小会话。
 * 新局、Profile、迁移和完整内容引用校验由更上层或后续阶段负责。
 */
export const createGameSession = (dependencies: GameSessionDependencies): GameSession => {
  let snapshot: GameSessionSnapshot = emptySnapshot();
  let busy = false;
  const listeners = new Set<() => void>();
  const feedbackListeners = new Set<(feedback: readonly FeedbackRequest[]) => void>();

  const notify = (listener: () => void): void => {
    try {
      listener();
    } catch {
      // 订阅者属于表现层；其异常不能改变已经发布的提交事实。
    }
  };

  const publish = (nextSnapshot: GameSessionSnapshot): void => {
    snapshot = nextSnapshot;
    for (const listener of [...listeners]) {
      notify(listener);
    }
  };

  const publishNeedsReload = (error: GameSessionError): void => {
    if (
      snapshot.status !== "ready" &&
      snapshot.status !== "saving" &&
      snapshot.status !== "needsReload"
    ) {
      return;
    }

    publish(needsReloadSnapshot(snapshot, error));
  };

  const notifyFeedback = (feedback: readonly FeedbackRequest[]): void => {
    const frozenFeedback = deepFreeze(feedback) as readonly FeedbackRequest[];
    for (const listener of [...feedbackListeners]) {
      try {
        listener(frozenFeedback);
      } catch {
        // 反馈只是临时表现；监听器失败不应把成功提交伪装成失败。
      }
    }
  };

  const busyFailure = (): GameSessionFailure =>
    failure(createError("BUSY", "Another session operation is already in progress."));

  const invalidLoadIdentity = (
    expectedSaveId: string,
    expectedProfileId: string,
    loaded: SaveEnvelope,
  ): GameSessionError | null => {
    if (loaded.saveId !== expectedSaveId || loaded.profileId !== expectedProfileId) {
      return createError(
        "INVALID_SAVE",
        "The loaded save does not match the requested save and profile.",
      );
    }

    return null;
  };

  const load = async (saveId: string, profileId: string): Promise<GameSessionLoadResult> => {
    // 必须在第一个 await 前同步取得锁；load 期间也不接受迟到的 dispatch。
    if (busy) {
      return busyFailure();
    }

    busy = true;
    // 加载切换上下文时先离开 ready；失败后不会继续使用旧 Profile/存档。
    publish(loadingSnapshot());
    const loadFailure = (error: GameSessionError): GameSessionFailure => {
      publish(errorSnapshot(error));
      return failure(error);
    };

    try {
      let loaded: SaveEnvelope | null;
      try {
        loaded = await dependencies.saveRepository.load(saveId, profileId);
      } catch (error) {
        if (isSaveRepositoryError(error)) {
          if (error.code === "SAVE_NOT_FOUND") {
            return loadFailure(createError("SAVE_NOT_FOUND", error.message));
          }

          if (error.code === "INVALID_SAVE") {
            return loadFailure(createError("INVALID_SAVE", error.message));
          }
        }

        return loadFailure(
          createError("SAVE_LOAD_FAILED", getErrorMessage(error, "The save could not be loaded.")),
        );
      }

      if (loaded === null) {
        return loadFailure(
          createError("SAVE_NOT_FOUND", "The requested save was not found for this profile."),
        );
      }

      let parsedSave: SaveEnvelope;
      try {
        parsedSave = SaveEnvelopeSchema.parse(loaded);
      } catch (error) {
        return loadFailure(
          createError(
            "INVALID_SAVE",
            zodMessage(error, "The loaded save does not satisfy the save schema."),
          ),
        );
      }

      const identityError = invalidLoadIdentity(saveId, profileId, parsedSave);
      if (identityError) {
        return loadFailure(identityError);
      }

      let loadedContent: unknown;
      try {
        // 使用存档精确 contentRef，不能改成默认或最新版内容。
        loadedContent = await dependencies.contentRepository.load(parsedSave.contentRef);
      } catch (error) {
        return loadFailure(
          createError(
            "CONTENT_LOAD_FAILED",
            getErrorMessage(error, "The save content version could not be loaded."),
          ),
        );
      }

      let parsedContent: ContentCatalog;
      try {
        parsedContent = ContentCatalogSchema.parse(loadedContent);
      } catch (error) {
        return loadFailure(
          createError(
            "CONTENT_INVALID",
            zodMessage(error, "The loaded content does not satisfy the content schema."),
          ),
        );
      }

      if (
        parsedContent.manifest.packageId !== parsedSave.contentRef.packageId ||
        parsedContent.manifest.version !== parsedSave.contentRef.version
      ) {
        return loadFailure(
          createError(
            "CONTENT_MISMATCH",
            "The loaded content manifest does not match the save content reference.",
          ),
        );
      }

      const frozenEnvelope = freezeEnvelope(parsedSave);
      const frozenContent = freezeContent(parsedContent);
      const nextSnapshot = readySnapshot(frozenEnvelope, frozenContent);
      publish(nextSnapshot);

      return Object.freeze({
        ok: true as const,
        snapshot: nextSnapshot,
      });
    } finally {
      busy = false;
    }
  };

  const dispatch = async (command: GameCommand): Promise<GameSessionDispatchResult> => {
    // 与 load 共用同一锁；这里没有排队器，迟到点击直接返回 BUSY。
    if (busy) {
      return busyFailure();
    }

    busy = true;
    try {
      if (snapshot.status === "needsReload") {
        return failure(
          createError(
            "RELOAD_REQUIRED",
            "The session must be explicitly reloaded before another command is accepted.",
          ),
        );
      }

      if (snapshot.status !== "ready") {
        return failure(
          createError("NOT_LOADED", "Load an existing save before dispatching commands."),
        );
      }

      let parsedCommand: GameCommand;
      try {
        parsedCommand = GameCommandSchema.parse(command);
      } catch (error) {
        return failure(
          createError(
            "INVALID_COMMAND",
            zodMessage(error, "The command does not satisfy the game command schema."),
          ),
        );
      }

      let nowIso: string;
      try {
        nowIso = dependencies.clock();
        nowIso = TransitionContextSchema.parse({ nowIso }).nowIso;
      } catch (error) {
        return failure(
          createError("CLOCK_ERROR", getErrorMessage(error, "The session clock failed.")),
        );
      }

      const baseSnapshot = snapshot;
      const baseEnvelope = baseSnapshot.envelope;
      let transitionResult: unknown;
      try {
        // 给规则层一个副本，防止意外 mutation 改写已发布快照；结果仍会重新过 Schema。
        const transitionState = GameStateSchema.parse(baseSnapshot.state);
        transitionResult = dependencies.transition(
          transitionState,
          parsedCommand,
          baseSnapshot.content,
          { nowIso },
        );
      } catch (error) {
        return failure(
          createError(
            "TRANSITION_ERROR",
            getErrorMessage(error, "The transition function failed before saving."),
          ),
        );
      }

      let checkedTransition: ReturnType<typeof TransitionResultSchema.safeParse>;
      try {
        checkedTransition = TransitionResultSchema.safeParse(transitionResult);
      } catch (error) {
        return failure(
          createError(
            "TRANSITION_ERROR",
            getErrorMessage(error, "The transition function returned an invalid result."),
          ),
        );
      }
      if (!checkedTransition.success) {
        return failure(
          createError(
            "TRANSITION_ERROR",
            zodMessage(
              checkedTransition.error,
              "The transition function returned an invalid result.",
            ),
          ),
        );
      }

      if (!checkedTransition.data.ok) {
        return failure(createError(checkedTransition.data.code, checkedTransition.data.message));
      }

      const candidateState = checkedTransition.data.nextState;
      // 让 saving 快照保留旧封套，同时在提交期间禁止任何交互。
      publish(savingSnapshot(baseSnapshot));
      let commitResult: { revision: number };
      try {
        // commit 是本次操作的唯一 await 写边界；expectedRevision 来自刚读取的已提交封套。
        commitResult = await dependencies.saveRepository.commit({
          saveId: baseEnvelope.saveId,
          profileId: baseEnvelope.profileId,
          expectedRevision: baseEnvelope.revision,
          nextState: GameStateSchema.parse(candidateState),
          updatedAt: nowIso,
        });
      } catch (error) {
        if (isSaveRepositoryError(error)) {
          if (error.code === "REVISION_CONFLICT") {
            publishNeedsReload(createError("REVISION_CONFLICT", error.message));
            return failure(createError("REVISION_CONFLICT", error.message));
          }

          publish(readySnapshot(baseEnvelope, baseSnapshot.content));
          return failure(createError(error.code, error.message));
        }

        const reloadError = createError(
          "RELOAD_REQUIRED",
          "The save result is uncertain; reload the save before continuing.",
        );
        publishNeedsReload(reloadError);
        return failure(reloadError);
      }

      if (
        !commitResult ||
        !isSafeRevision(commitResult.revision) ||
        commitResult.revision !== baseEnvelope.revision + 1
      ) {
        const reloadError = createError(
          "RELOAD_REQUIRED",
          "The save returned an invalid revision; reload the save before continuing.",
        );
        publishNeedsReload(reloadError);
        return failure(reloadError);
      }

      let committedEnvelope: Readonly<SaveEnvelope>;
      try {
        committedEnvelope = freezeEnvelope({
          ...baseEnvelope,
          revision: commitResult.revision,
          updatedAt: nowIso,
          state: candidateState,
        });
      } catch (error) {
        const reloadError = createError(
          "RELOAD_REQUIRED",
          zodMessage(
            error,
            "The save succeeded but its published envelope could not be validated; reload the save.",
          ),
        );
        publishNeedsReload(reloadError);
        return failure(reloadError);
      }

      const nextSnapshot = readySnapshot(committedEnvelope, baseSnapshot.content);
      publish(nextSnapshot);

      const feedback = deepFreeze(checkedTransition.data.feedback) as readonly FeedbackRequest[];
      notifyFeedback(feedback);

      return Object.freeze({
        ok: true as const,
        snapshot: nextSnapshot,
        feedback,
      });
    } finally {
      busy = false;
    }
  };

  return {
    load,
    dispatch,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeFeedback: (listener: (feedback: readonly FeedbackRequest[]) => void): (() => void) => {
      feedbackListeners.add(listener);
      return () => {
        feedbackListeners.delete(listener);
      };
    },
  };
};
