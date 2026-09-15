import { describe, expect, it, vi } from "vitest";
import type { ContentCatalog, ContentRef } from "../../src/content/schema";
import { MINIMAL_CATALOG } from "../../src/content/fixtures/minimalCatalog";
import type { ContentRepository } from "../../src/content/repository";
import {
  createGameSession,
  type GameSession,
  type GameSessionDependencies,
} from "../../src/application/gameSession";
import type { GameCommand, Transition } from "../../src/game/commands";
import type { GameState, SaveEnvelope } from "../../src/game/model";
import {
  SaveRepositoryError,
  type SaveCommitInput,
  type SaveCommitResult,
  type SaveRepository,
} from "../../src/storage/saveRepository";

const NOW = "2026-09-14T12:00:00.000Z";

const initialState = (): GameState => ({
  phase: { type: "playing" },
  attributes: { restraint: 50 },
  flags: {},
  cases: {},
  pendingStoryIds: [],
  completedStoryIds: [],
});

const makeSave = (overrides: Partial<SaveEnvelope> = {}): SaveEnvelope => ({
  saveId: "save-1",
  profileId: "profile-1",
  revision: 0,
  saveSchemaVersion: 1,
  contentRef: {
    packageId: MINIMAL_CATALOG.manifest.packageId,
    version: MINIMAL_CATALOG.manifest.version,
  },
  createdAt: NOW,
  updatedAt: NOW,
  state: initialState(),
  ...overrides,
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

class TestSaveRepository implements SaveRepository {
  save: SaveEnvelope;
  commitCalls: SaveCommitInput[] = [];
  commitImpl: (input: SaveCommitInput) => Promise<SaveCommitResult> | SaveCommitResult = ({
    expectedRevision,
  }) => ({
    revision: expectedRevision + 1,
  });

  constructor(save = makeSave()) {
    this.save = clone(save);
  }

  async load(saveId: string, profileId: string): Promise<SaveEnvelope | null> {
    if (saveId !== this.save.saveId || profileId !== this.save.profileId) {
      return null;
    }

    return clone(this.save);
  }

  async create(save: SaveEnvelope): Promise<void> {
    this.save = clone(save);
  }

  async commit(input: SaveCommitInput): Promise<SaveCommitResult> {
    this.commitCalls.push(clone(input));
    const result = await this.commitImpl(input);
    this.save = {
      ...this.save,
      revision: result.revision,
      updatedAt: input.updatedAt,
      state: clone(input.nextState),
    };
    return result;
  }
}

class TestContentRepository implements ContentRepository {
  readonly refs: ContentRef[] = [];
  catalog: ContentCatalog = MINIMAL_CATALOG;
  loadImpl?: (ref: ContentRef) => Promise<Readonly<ContentCatalog>>;

  async load(ref: ContentRef): Promise<Readonly<ContentCatalog>> {
    this.refs.push(clone(ref));
    if (this.loadImpl) {
      return this.loadImpl(ref);
    }

    return clone(this.catalog);
  }
}

const makeSession = (
  saveRepository: TestSaveRepository = new TestSaveRepository(),
  contentRepository: TestContentRepository = new TestContentRepository(),
  transition: Transition = ((state) => ({
    ok: true,
    nextState: {
      ...state,
      attributes: {
        ...state.attributes,
        restraint: state.attributes.restraint + 1,
      },
    },
    feedback: [],
  })) as Transition,
  clock: () => string = () => NOW,
): {
  session: GameSession;
  saveRepository: TestSaveRepository;
  contentRepository: TestContentRepository;
} => {
  const dependencies: GameSessionDependencies = {
    saveRepository,
    contentRepository,
    transition,
    clock,
  };

  return {
    session: createGameSession(dependencies),
    saveRepository,
    contentRepository,
  };
};

const command: GameCommand = { type: "startCase", caseId: "case_001" };

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("GameSession", () => {
  it("holds the old state and returns BUSY while a commit is delayed", async () => {
    const commit = deferred<SaveCommitResult>();
    const { session, saveRepository } = makeSession();
    saveRepository.commitImpl = () => commit.promise;
    await session.load("save-1", "profile-1");

    const firstDispatch = session.dispatch(command);
    expect(session.getSnapshot().status).toBe("saving");
    expect(session.getSnapshot().state?.attributes.restraint).toBe(50);
    expect(await session.dispatch(command)).toMatchObject({
      ok: false,
      code: "BUSY",
    });
    expect(saveRepository.commitCalls).toHaveLength(1);

    commit.resolve({ revision: 1 });
    const result = await firstDispatch;
    expect(result.ok).toBe(true);
    expect(session.getSnapshot().state?.attributes.restraint).toBe(51);
  });

  it("exposes saving while committing and restores ready after a confirmed save failure", async () => {
    const { session, saveRepository } = makeSession();
    await session.load("save-1", "profile-1");
    const states: string[] = [];
    session.subscribe(() => states.push(session.getSnapshot().status));
    saveRepository.commitImpl = async () => {
      throw new SaveRepositoryError("SAVE_NOT_FOUND", "save disappeared");
    };

    const result = await session.dispatch(command);
    expect(result).toMatchObject({ ok: false, code: "SAVE_NOT_FOUND" });
    expect(session.getSnapshot().status).toBe("ready");
    expect(session.getSnapshot().state?.attributes.restraint).toBe(50);
    expect(states).toEqual(["saving", "ready"]);
  });

  it("publishes after a successful commit and then emits feedback", async () => {
    const transition: Transition = (state) => ({
      ok: true,
      nextState: {
        ...state,
        attributes: { ...state.attributes, restraint: 55 },
      },
      feedback: [
        {
          type: "attributeFeedback",
          caseId: "case_001",
          changes: [
            {
              attributeId: "restraint",
              label: "克制",
              before: 50,
              after: 55,
              actualDelta: 5,
            },
          ],
        },
      ],
    });
    const { session } = makeSession(undefined, undefined, transition);
    await session.load("save-1", "profile-1");

    const events: string[] = [];
    session.subscribe(() => events.push("snapshot"));
    session.subscribeFeedback(() => events.push("feedback"));

    const result = await session.dispatch(command);
    expect(result.ok).toBe(true);
    expect(events).toEqual(["snapshot", "snapshot", "feedback"]);
    expect(session.getSnapshot().state?.attributes.restraint).toBe(55);
  });

  it("enters needsReload after an unknown commit failure and recovers only on explicit load", async () => {
    const { session, saveRepository } = makeSession();
    await session.load("save-1", "profile-1");
    saveRepository.commitImpl = async () => {
      throw new Error("connection dropped after write");
    };

    const failed = await session.dispatch(command);
    expect(failed).toMatchObject({ ok: false, code: "RELOAD_REQUIRED" });
    expect(session.getSnapshot().status).toBe("needsReload");
    expect(await session.dispatch(command)).toMatchObject({
      ok: false,
      code: "RELOAD_REQUIRED",
    });

    const loaded = await session.load("save-1", "profile-1");
    expect(loaded.ok).toBe(true);
    expect(session.getSnapshot().status).toBe("ready");
  });

  it("enters needsReload on a revision conflict", async () => {
    const { session, saveRepository } = makeSession();
    await session.load("save-1", "profile-1");
    saveRepository.commitImpl = async () => {
      throw new SaveRepositoryError("REVISION_CONFLICT", "stale revision");
    };

    const result = await session.dispatch(command);
    expect(result).toMatchObject({ ok: false, code: "REVISION_CONFLICT" });
    expect(session.getSnapshot().status).toBe("needsReload");
  });

  it("keeps exact content version binding and rejects a mismatched manifest", async () => {
    const { session, contentRepository } = makeSession();
    const result = await session.load("save-1", "profile-1");
    expect(result.ok).toBe(true);
    expect(contentRepository.refs).toEqual([
      {
        packageId: "minimal-test-package",
        version: "1.0.0",
      },
    ]);

    const mismatchingContent = new TestContentRepository();
    mismatchingContent.catalog = {
      ...clone(MINIMAL_CATALOG),
      manifest: {
        ...MINIMAL_CATALOG.manifest,
        version: "2.0.0",
      },
    };
    const mismatchSession = makeSession(new TestSaveRepository(), mismatchingContent).session;
    const mismatch = await mismatchSession.load("save-1", "profile-1");
    expect(mismatch).toMatchObject({ ok: false, code: "CONTENT_MISMATCH" });
    expect(mismatchSession.getSnapshot().status).toBe("error");
  });

  it("does not write or publish when the pure transition rejects a command", async () => {
    const transition: Transition = () => ({
      ok: false,
      code: "INVALID_CHOICE",
      message: "the choice is not valid",
    });
    const { session, saveRepository } = makeSession(undefined, undefined, transition);
    await session.load("save-1", "profile-1");
    const before = session.getSnapshot();
    const listener = vi.fn();
    session.subscribe(listener);

    const result = await session.dispatch(command);
    expect(result).toMatchObject({ ok: false, code: "INVALID_CHOICE" });
    expect(saveRepository.commitCalls).toHaveLength(0);
    expect(session.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("isolates state mutation by a transition and ignores observer failures", async () => {
    const transition: Transition = (state) => {
      (state.attributes as Record<string, number>).restraint = 999;
      return {
        ok: true,
        nextState: {
          ...state,
          attributes: { ...state.attributes, restraint: 60 },
        },
        feedback: [],
      };
    };
    const { session } = makeSession(undefined, undefined, transition);
    await session.load("save-1", "profile-1");
    session.subscribe(() => {
      throw new Error("render failed");
    });
    session.subscribeFeedback(() => {
      throw new Error("animation failed");
    });

    const result = await session.dispatch(command);
    expect(result.ok).toBe(true);
    expect(session.getSnapshot().state?.attributes.restraint).toBe(60);
    expect(Object.isFrozen(session.getSnapshot())).toBe(true);
    expect(Object.isFrozen(session.getSnapshot().state)).toBe(true);
    expect(session.getSnapshot()).toBe(session.getSnapshot());
  });

  it("locks dispatch while an asynchronous load is in progress", async () => {
    const load = deferred<SaveEnvelope | null>();
    const saveRepository = new TestSaveRepository();
    saveRepository.load = () => load.promise;
    const { session } = makeSession(saveRepository);

    const loading = session.load("save-1", "profile-1");
    expect(await session.dispatch(command)).toMatchObject({
      ok: false,
      code: "BUSY",
    });
    load.resolve(makeSave());
    expect((await loading).ok).toBe(true);
  });

  it("leaves ready before a load and does not restore the old context when loading fails", async () => {
    const { session, saveRepository } = makeSession();
    await session.load("save-1", "profile-1");
    saveRepository.load = async () => null;

    const loading = session.load("missing-save", "profile-1");
    expect(session.getSnapshot().status).toBe("loading");
    expect(await loading).toMatchObject({ ok: false, code: "SAVE_NOT_FOUND" });
    expect(session.getSnapshot().status).toBe("error");
    expect(session.getSnapshot().state).toBeNull();
    expect(await session.dispatch(command)).toMatchObject({
      ok: false,
      code: "NOT_LOADED",
    });
  });

  it("rejects malformed loaded envelopes before touching content", async () => {
    const contentRepository = new TestContentRepository();
    const saveRepository = new TestSaveRepository();
    saveRepository.load = async () =>
      ({
        ...makeSave(),
        saveSchemaVersion: 99,
      }) as unknown as SaveEnvelope;
    const { session } = makeSession(saveRepository, contentRepository);

    const result = await session.load("save-1", "profile-1");
    expect(result).toMatchObject({ ok: false, code: "INVALID_SAVE" });
    expect(contentRepository.refs).toHaveLength(0);
  });

  it("turns an invalid transition result into a returned error instead of a rejected Promise", async () => {
    const transition = (() => undefined) as unknown as Transition;
    const { session } = makeSession(undefined, undefined, transition);
    await session.load("save-1", "profile-1");

    await expect(session.dispatch(command)).resolves.toMatchObject({
      ok: false,
      code: "TRANSITION_ERROR",
    });
    expect(session.getSnapshot().status).toBe("ready");
  });
});
