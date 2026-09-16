import { describe, expect, it, vi } from "vitest";
import type {
  ContentLocale,
  ContentRef,
  GameContentCatalog,
  LocalizedContentCatalog,
} from "../../src/content/schema";
import {
  MINIMAL_GAME_CONTENT,
  MINIMAL_LOCALIZATIONS,
} from "../../src/content/fixtures/minimalCatalog";
import { ContentRepositoryError, type SplitContentRepository } from "../../src/content/repository";
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
  attributes: { restraint: 50, authority: 50 },
  flags: { first_case_closed: false, second_case_reviewed: false },
  cases: {},
  pendingStoryIds: [],
  completedStoryIds: [],
  storyCheckpoint: null,
});

const makeSave = (overrides: Partial<SaveEnvelope> = {}): SaveEnvelope => ({
  saveId: "save-1",
  profileId: "profile-1",
  revision: 0,
  saveSchemaVersion: 3,
  contentRef: {
    packageId: MINIMAL_GAME_CONTENT.manifest.packageId,
    version: MINIMAL_GAME_CONTENT.manifest.version,
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

class TestContentRepository implements SplitContentRepository {
  readonly refs: ContentRef[] = [];
  catalog: GameContentCatalog = MINIMAL_GAME_CONTENT;
  loadImpl?: (ref: ContentRef) => Promise<Readonly<GameContentCatalog>>;

  async loadGameContent(ref: ContentRef): Promise<Readonly<GameContentCatalog>> {
    this.refs.push(clone(ref));
    if (this.loadImpl) {
      return this.loadImpl(ref);
    }

    return clone(this.catalog);
  }

  async loadLocalization(
    _ref: ContentRef,
    locale: ContentLocale,
  ): Promise<Readonly<LocalizedContentCatalog>> {
    return clone(MINIMAL_LOCALIZATIONS[locale]);
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

const semanticallyInvalidContent: readonly {
  readonly name: string;
  readonly mutate: (catalog: GameContentCatalog) => void;
}[] = [
  {
    name: "missing start",
    mutate: (catalog) => {
      catalog.cases.case_001.startNodeId = "missing_start";
    },
  },
  {
    name: "missing target",
    mutate: (catalog) => {
      catalog.cases.case_001.nodes.assessment.choices[0].target = {
        type: "resolution",
        resolutionId: "missing_resolution",
      };
    },
  },
  {
    name: "invalid progression",
    mutate: (catalog) => {
      catalog.unlockRules[0].caseIds = ["missing_case"];
    },
  },
  {
    name: "graph cycle",
    mutate: (catalog) => {
      catalog.cases.case_001.nodes.assessment.choices[1].target = {
        type: "node",
        nodeId: "assessment",
      };
    },
  },
  {
    name: "missing asset",
    mutate: (catalog) => {
      const step = catalog.stories.ending_balanced.steps[0];
      if (step.type !== "video") {
        throw new Error("Expected fixture video step.");
      }
      step.assetId = "missing_asset";
    },
  },
];

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
          source: { type: "case", caseId: "case_001" },
          changes: [
            {
              attributeId: "restraint",
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

  it("enters needsReload after an unknown commit failure and recovers on explicit identity-free reload", async () => {
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

    const loaded = await session.reload();
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
      ...clone(MINIMAL_GAME_CONTENT),
      manifest: {
        ...MINIMAL_GAME_CONTENT.manifest,
        version: "2.0.0",
      },
    };
    const mismatchSession = makeSession(new TestSaveRepository(), mismatchingContent).session;
    const mismatch = await mismatchSession.load("save-1", "profile-1");
    expect(mismatch).toMatchObject({ ok: false, code: "CONTENT_MISMATCH" });
    expect(mismatchSession.getSnapshot().status).toBe("error");
  });

  it.each(semanticallyInvalidContent)(
    "rejects $name returned by an arbitrary ContentRepository",
    async ({ mutate }) => {
      const contentRepository = new TestContentRepository();
      contentRepository.catalog = clone(MINIMAL_GAME_CONTENT);
      mutate(contentRepository.catalog);
      const { session, saveRepository } = makeSession(new TestSaveRepository(), contentRepository);

      const result = await session.load("save-1", "profile-1");

      expect(result).toMatchObject({ ok: false, code: "CONTENT_INVALID" });
      if (result.ok) {
        throw new Error("Expected invalid content to be rejected.");
      }
      expect(result.message).toMatch(/loaded content is invalid \(\d+ content issue\(s\)\)/u);
      expect(session.getSnapshot()).toMatchObject({
        status: "error",
        envelope: null,
        state: null,
        content: null,
        error: { code: "CONTENT_INVALID" },
      });
      expect(saveRepository.commitCalls).toHaveLength(0);
    },
  );

  it("preserves INVALID_CONTENT classification from a validating repository", async () => {
    const contentRepository = new TestContentRepository();
    contentRepository.loadImpl = async () => {
      throw new ContentRepositoryError(
        "INVALID_CONTENT",
        "The stored content catalog is invalid (1 content issue(s)).",
        Object.freeze([]),
      );
    };
    const { session } = makeSession(new TestSaveRepository(), contentRepository);

    const result = await session.load("save-1", "profile-1");

    expect(result).toEqual({
      ok: false,
      code: "CONTENT_INVALID",
      message: "The stored content catalog is invalid (1 content issue(s)).",
    });
    expect(session.getSnapshot().status).toBe("error");
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

describe("GameSession load invariants and recovery identity", () => {
  it.each(["attributes", "node", "history"])(
    "rejects schema-valid invalid %s before ready",
    async (kind) => {
      const save = makeSave();
      if (kind === "attributes") delete save.state.attributes.authority;
      else
        save.state.cases.case_001 = {
          status: "active",
          currentNodeId: kind === "node" ? "missing_node" : "disposition",
          history: [],
        };
      const { session, saveRepository } = makeSession(new TestSaveRepository(save));
      const statuses: string[] = [];
      session.subscribe(() => statuses.push(session.getSnapshot().status));
      expect(await session.load("save-1", "profile-1")).toMatchObject({
        ok: false,
        code: "INVALID_SAVE",
      });
      expect(statuses).toEqual(["loading", "error"]);
      expect(session.getSnapshot().state).toBeNull();
      expect(saveRepository.commitCalls).toEqual([]);
    },
  );

  it("retries the latest failed identity and never falls back to an old profile", async () => {
    const { session, saveRepository } = makeSession();
    expect(await session.reload()).toMatchObject({ ok: false, code: "NOT_LOADED" });
    await session.load("save-1", "profile-1");
    await session.load("save-2", "profile-2");
    expect(await session.reload()).toMatchObject({ ok: false, code: "SAVE_NOT_FOUND" });
    saveRepository.save = makeSave({ saveId: "save-2", profileId: "profile-2", revision: 7 });
    expect(await session.reload()).toMatchObject({
      ok: true,
      snapshot: { envelope: { saveId: "save-2", profileId: "profile-2", revision: 7 } },
    });
  });

  it("shares the operation lock and does not let rejected loads change recovery identity", async () => {
    const { session, saveRepository } = makeSession();
    const pending = deferred<SaveEnvelope | null>();
    const load = vi.spyOn(saveRepository, "load").mockReturnValueOnce(pending.promise);
    const loading = session.load("save-1", "profile-1");
    expect(await session.reload()).toMatchObject({ ok: false, code: "BUSY" });
    expect(await session.load("other", "other")).toMatchObject({ ok: false, code: "BUSY" });
    pending.resolve(makeSave());
    await loading;
    await session.reload();
    expect(load).toHaveBeenLastCalledWith("save-1", "profile-1");
    const commit = deferred<SaveCommitResult>();
    saveRepository.commitImpl = () => commit.promise;
    const saving = session.dispatch(command);
    expect(await session.reload()).toMatchObject({ ok: false, code: "BUSY" });
    commit.resolve({ revision: 1 });
    await saving;
    await session.reload();
    expect(session.getSnapshot().envelope?.revision).toBe(1);
  });
});
