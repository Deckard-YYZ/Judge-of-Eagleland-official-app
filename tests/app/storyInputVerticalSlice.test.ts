import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTION_INPUT_GAME_CONTENT,
  ACTION_INPUT_LOCALIZATIONS,
} from "../../src/app/actionInputContent";
import { createDemoSave } from "../../src/app/demoSession";
import { createGameSession, type GameSession } from "../../src/application/gameSession";
import { BundledSplitContentRepository } from "../../src/content/bundledRepository";
import type { GameContentCatalog, LocalizedContentCatalog } from "../../src/content/schema";
import type { GameCommand } from "../../src/game/commands";
import { GameStateSchema } from "../../src/game/model";
import { transition } from "../../src/game/transition";
import { matchTextAction } from "../../src/input/matchTextAction";
import type { BundledPackageReader } from "../../src/platform/contentResources";
import { SaveRepositoryError } from "../../src/storage/saveRepository";
import { SqliteSaveRepository } from "../../src/storage/sqliteSaveRepository";
import {
  createSqliteTestDatabase,
  type NodeSqliteTestDatabase,
  type SqliteTestDatabase,
} from "../fixtures/storage/sqliteTestDatabase";

const firstStory = "inspection_after_case_001";
const secondStory = "inspection_after_case_002";
const now = "2026-09-16T00:00:00.000Z";
const ref = { packageId: "minimal-test-package", version: "1.1.0" };
const fixtures: SqliteTestDatabase[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fixture of fixtures.splice(0)) await fixture.cleanup();
});

/** Only native file transport is replaced; production package validation still runs. */
const readPackage: BundledPackageReader = async ({ packageId, version }) => {
  const root = new URL(`../../content/${packageId}/${version}/`, import.meta.url);
  const fileInventory = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(fileURLToPath(root), join(entry.parentPath, entry.name)).replaceAll("\\", "/"),
    );
  const sources = await Promise.all(
    fileInventory
      .filter((path) => path.endsWith(".json"))
      .map(async (source) => ({ source, text: await readFile(new URL(source, root), "utf8") })),
  );
  return { sources, fileInventory };
};

// Variants exercise terminal-input/no-effects contracts through the same loader;
// the shipped fixture always retains its full A -> B -> C -> D -> E sequence.
function repository(edit?: (content: GameContentCatalog) => void) {
  return new BundledSplitContentRepository(async (contentRef) => {
    const original = await readPackage(contentRef);
    const files = { ...original, sources: original.sources.map((source) => ({ ...source })) };
    if (edit) {
      const source = files.sources.find((source) => source.source === "game.json")!;
      const content = JSON.parse(source.text) as GameContentCatalog;
      edit(content);
      source.text = JSON.stringify(content);
      for (const source of files.sources.filter((source) => source.source.startsWith("locales/"))) {
        const locale = JSON.parse(source.text) as LocalizedContentCatalog;
        for (const [storyId, story] of Object.entries(content.stories)) {
          locale.stories[storyId].steps = Object.fromEntries(
            story.steps.map((step) => [step.id, locale.stories[storyId].steps[step.id]]),
          );
        }
        source.text = JSON.stringify(locale);
      }
    }
    return files;
  });
}

async function open(database: NodeSqliteTestDatabase, contentRepository = repository()) {
  const saves = new SqliteSaveRepository(database);
  const session = createGameSession({
    saveRepository: saves,
    contentRepository,
    transition,
    clock: () => now,
  });
  expect((await session.load("save", "profile")).ok).toBe(true);
  return { session, saves };
}

async function setup(edit?: (content: GameContentCatalog) => void) {
  const fixture = createSqliteTestDatabase();
  fixtures.push(fixture);
  const contentRepository = repository(edit);
  const content = await contentRepository.loadGameContent(ref);
  fixture.database.native
    .prepare("INSERT INTO profiles VALUES (?, ?, ?, ?)")
    .run("profile", "inspector", "Inspector", now);
  await new SqliteSaveRepository(fixture.database).create(
    createDemoSave("profile", "save", content, now),
  );
  return { fixture, ...(await open(fixture.database, contentRepository)) };
}

function persisted(database: NodeSqliteTestDatabase) {
  const row = database.native
    .prepare("SELECT revision, save_schema_version, state_json FROM saves WHERE save_id = 'save'")
    .get()!;
  return {
    revision: Number(row.revision),
    schema: row.save_schema_version,
    state: GameStateSchema.parse(JSON.parse(String(row.state_json))),
  };
}

async function accept(session: GameSession, command: GameCommand) {
  const result = await session.dispatch(command);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result;
}

function input(
  stepId: string,
  actionId: "salute" | "wave" = "salute",
  storyId = firstStory,
): GameCommand {
  return { type: "submitStoryInput", storyId, stepId, actionId };
}

async function reachInspection(session: GameSession) {
  await accept(session, { type: "startCase", caseId: "case_001" });
  await accept(session, {
    type: "chooseOption",
    caseId: "case_001",
    nodeId: "assessment",
    choiceId: "insufficient_evidence",
  });
  expect(session.getSnapshot().state!.pendingStoryIds).toEqual([
    "story_after_case_001",
    firstStory,
  ]);
  await accept(session, { type: "completeStory", storyId: "story_after_case_001" });
}

describe("action-input fixed fixture through GameSession and disk SQLite", () => {
  it("loads the same schema-v3 physical package and both localizations as the browser bridge", async () => {
    const contentRepository = repository();
    expect(await contentRepository.loadGameContent(ref)).toEqual(ACTION_INPUT_GAME_CONTENT);
    for (const locale of ["zh-CN", "en-US"] as const) {
      expect(await contentRepository.loadLocalization(ref, locale)).toEqual(
        ACTION_INPUT_LOCALIZATIONS[locale],
      );
    }
    expect(ACTION_INPUT_GAME_CONTENT.initial.storyIds).toEqual([]);
    const previous = await contentRepository.loadGameContent({ ...ref, version: "1.0.0" });
    expect(ACTION_INPUT_GAME_CONTENT.cases).toEqual(previous.cases);
    expect(ACTION_INPUT_GAME_CONTENT.assets).toEqual(previous.assets);
    for (const [storyId, story] of Object.entries(previous.stories)) {
      expect(ACTION_INPUT_GAME_CONTENT.stories[storyId]).toEqual(story);
    }
    expect(ACTION_INPUT_GAME_CONTENT.stories[firstStory]).toEqual(
      ACTION_INPUT_GAME_CONTENT.stories[secondStory],
    );
  });

  it("restores C after B, restores D after a wrong attempt once, and keeps two story positions independent", async () => {
    const { fixture, session: initial } = await setup();
    let database = fixture.database;
    let session = initial;
    await reachInspection(session);
    const settlement = structuredClone(session.getSnapshot().state!.cases.case_001);
    const before = persisted(database);
    expect(await session.dispatch(input("salute_at_departure"))).toMatchObject({
      ok: false,
      code: "STALE_STORY_INPUT",
    });
    expect(await session.dispatch({ type: "completeStory", storyId: firstStory })).toMatchObject({
      ok: false,
      code: "STORY_INPUT_REQUIRED",
    });
    expect(persisted(database)).toEqual(before);
    await accept(session, input("salute_at_arrival"));
    const passedB = persisted(database);
    expect(passedB).toMatchObject({
      revision: before.revision + 1,
      schema: 3,
      state: { storyCheckpoint: { storyId: firstStory, resumeStepId: "inspection_notice" } },
    });
    await database.close();
    database = fixture.openConnection();
    session = (await open(database)).session;
    expect(session.getSnapshot().state).toEqual(passedB.state);
    expect(await session.dispatch(input("salute_at_arrival", "wave"))).toMatchObject({
      ok: false,
      code: "STALE_STORY_INPUT",
    });
    expect(persisted(database)).toEqual(passedB);
    const wrong = await accept(session, input("salute_at_departure", "wave"));
    expect(wrong).toMatchObject({
      feedback: [
        {
          type: "inputFeedback",
          source: { type: "storyInput", storyId: firstStory, stepId: "salute_at_departure" },
        },
        { type: "attributeFeedback" },
      ],
    });
    const failedD = persisted(database);
    expect(failedD.state.attributes.authority).toBe(passedB.state.attributes.authority - 1);
    expect(failedD.state.storyCheckpoint).toEqual({
      storyId: firstStory,
      resumeStepId: "salute_at_departure",
    });
    expect(failedD.state.cases.case_001).toEqual(settlement);
    await database.close();
    database = fixture.openConnection();
    session = (await open(database)).session;
    expect(session.getSnapshot().state).toEqual(failedD.state);
    expect(persisted(database)).toEqual(failedD);
    await accept(session, input("salute_at_departure"));
    const tail = persisted(database);
    expect(tail.state.storyCheckpoint).toEqual({ storyId: firstStory, resumeStepId: "departure" });
    expect(tail.state.completedStoryIds).not.toContain(firstStory);
    // Reading/reloading ordinary tail text performs no save; only Story completion commits.
    expect((await session.reload()).ok).toBe(true);
    expect(persisted(database)).toEqual(tail);
    await accept(session, { type: "completeStory", storyId: firstStory });
    expect(persisted(database).revision).toBe(tail.revision + 1);
    await accept(session, { type: "startCase", caseId: "case_002" });
    await accept(session, {
      type: "chooseOption",
      caseId: "case_002",
      nodeId: "assessment",
      choiceId: "request_review",
    });
    expect(session.getSnapshot().state!.pendingStoryIds).toEqual([secondStory, "ending_balanced"]);
    expect(session.getSnapshot().state!.storyCheckpoint).toBeNull();
    expect(
      await session.dispatch(input("salute_at_departure", "salute", secondStory)),
    ).toMatchObject({ ok: false, code: "STALE_STORY_INPUT" });
    await accept(session, input("salute_at_arrival", "wave", secondStory));
    expect(session.getSnapshot().state!.storyCheckpoint).toEqual({
      storyId: secondStory,
      resumeStepId: "salute_at_arrival",
    });
    expect(session.getSnapshot().state!.completedStoryIds).toContain(firstStory);
    expect(session.getSnapshot().state!.cases.case_001).toEqual(settlement);
  });

  it("keeps unknown text local, commits a known wrong action without effects, and atomically finishes a terminal input", async () => {
    const { fixture, session } = await setup((content) => {
      content.stories[firstStory].steps = [
        { id: "salute_at_arrival", type: "actionInput", targetActionId: "salute" },
      ];
    });
    await reachInspection(session);
    const before = persisted(fixture.database);
    const dispatch = vi.spyOn(session, "dispatch");
    const submitText = async (text: string) => {
      const recognized = matchTextAction(text, "en-US");
      if (recognized.type === "known")
        return session.dispatch(input("salute_at_arrival", recognized.actionId));
      return recognized;
    };
    expect(await submitText("unrecognized gesture")).toEqual({ type: "unknown" });
    expect(dispatch).not.toHaveBeenCalled();
    expect(persisted(fixture.database)).toEqual(before);
    expect(await submitText("wave")).toMatchObject({
      ok: true,
      feedback: [{ type: "inputFeedback" }],
    });
    const wrong = persisted(fixture.database);
    expect(wrong.revision).toBe(before.revision + 1);
    expect(wrong.state.attributes).toEqual(before.state.attributes);
    expect(await submitText("salute")).toMatchObject({ ok: true });
    const completed = persisted(fixture.database);
    expect(completed.revision).toBe(wrong.revision + 1);
    expect(completed.state.completedStoryIds).toContain(firstStory);
    expect(completed.state.pendingStoryIds).toEqual([]);
    expect(completed.state.storyCheckpoint).toBeNull();
  });

  it("never publishes candidate state or feedback on a known write failure or an uncertain committed write", async () => {
    const { fixture, session, saves } = await setup();
    await reachInspection(session);
    const before = persisted(fixture.database);
    const feedback = vi.fn();
    session.subscribeFeedback(feedback);
    const published: unknown[] = [];
    session.subscribe(() => published.push(session.getSnapshot().state));
    const commit = saves.commit.bind(saves);
    vi.spyOn(saves, "commit").mockRejectedValueOnce(
      new SaveRepositoryError("INVALID_SAVE", "Rejected before write"),
    );
    expect(await session.dispatch(input("salute_at_arrival", "wave"))).toMatchObject({
      ok: false,
      code: "INVALID_SAVE",
    });
    expect(session.getSnapshot().status).toBe("ready");
    expect(persisted(fixture.database)).toEqual(before);
    vi.mocked(saves.commit).mockImplementationOnce(async (value) => {
      await commit(value);
      throw new Error("Transport lost the successful SQL acknowledgement");
    });
    expect(await session.dispatch(input("salute_at_arrival", "wave"))).toMatchObject({
      ok: false,
      code: "RELOAD_REQUIRED",
    });
    expect(session.getSnapshot().status).toBe("needsReload");
    expect(published.every((state) => JSON.stringify(state) === JSON.stringify(before.state))).toBe(
      true,
    );
    expect(feedback).not.toHaveBeenCalled();
    const committed = persisted(fixture.database);
    expect(committed.revision).toBe(before.revision + 1);
    expect(committed.state.attributes.authority).toBe(before.state.attributes.authority - 2);
    expect(await session.dispatch(input("salute_at_arrival", "wave"))).toMatchObject({
      ok: false,
      code: "RELOAD_REQUIRED",
    });
    expect((await session.reload()).ok).toBe(true);
    expect(session.getSnapshot().state).toEqual(committed.state);
    expect(persisted(fixture.database)).toEqual(committed);
    expect(feedback).not.toHaveBeenCalled();
  });

  it("uses real two-connection CAS to reject a competing attempt without duplicate effects", async () => {
    const { fixture, session } = await setup();
    await reachInspection(session);
    const competing = await open(fixture.openConnection());
    await accept(session, input("salute_at_arrival", "wave"));
    const committed = persisted(fixture.database);
    const feedback = vi.fn();
    competing.session.subscribeFeedback(feedback);
    expect(await competing.session.dispatch(input("salute_at_arrival", "wave"))).toMatchObject({
      ok: false,
      code: "REVISION_CONFLICT",
    });
    expect(competing.session.getSnapshot().status).toBe("needsReload");
    expect(feedback).not.toHaveBeenCalled();
    expect(persisted(fixture.database)).toEqual(committed);
    expect((await competing.session.reload()).ok).toBe(true);
    expect(competing.session.getSnapshot().state).toEqual(committed.state);
  });

  it("rejects a structurally valid missing checkpoint position at load without rewriting it", async () => {
    const { fixture, session } = await setup();
    await reachInspection(session);
    const corrupt = persisted(fixture.database).state;
    corrupt.storyCheckpoint = { storyId: firstStory, resumeStepId: "missing_step" };
    expect(GameStateSchema.safeParse(corrupt).success).toBe(true);
    fixture.database.native
      .prepare("UPDATE saves SET state_json = ? WHERE save_id = 'save'")
      .run(JSON.stringify(corrupt));
    const before = persisted(fixture.database);
    const statuses: string[] = [];
    session.subscribe(() => statuses.push(session.getSnapshot().status));
    expect(await session.reload()).toMatchObject({ ok: false, code: "INVALID_SAVE" });
    expect(statuses).not.toContain("ready");
    expect(session.getSnapshot()).toMatchObject({ status: "error", state: null });
    expect(persisted(fixture.database)).toEqual(before);
  });
});
