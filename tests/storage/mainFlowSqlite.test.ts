import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteProfileRepository } from "../../src/storage/profileRepository";
import { SqliteSaveRepository } from "../../src/storage/sqliteSaveRepository";
import { loadSplitContentPackage } from "../../src/content/localizedPackageFormat";
import type { GameCommand } from "../../src/game/commands";
import {
  mainFlowChoices,
  mainFlowSave,
  mainFlowSession,
  MAIN_FLOW_NOW,
} from "../fixtures/mainFlow";
import { pilotSave } from "../fixtures/configurationPilot";
import {
  createSqliteTestDatabase,
  NodeSqliteTestDatabase,
  type SqliteTestDatabase,
} from "../fixtures/storage/sqliteTestDatabase";

const databases: SqliteTestDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.cleanup();
});
async function setup(fixture?: Parameters<typeof mainFlowSession>[1]) {
  const db = createSqliteTestDatabase();
  databases.push(db);
  const profiles = new SqliteProfileRepository(db.database);
  await profiles.create({
    profileId: "main-profile",
    loginName: "main",
    displayName: "Main",
    createdAt: MAIN_FLOW_NOW,
  });
  const saves = new SqliteSaveRepository(db.database);
  await saves.create(mainFlowSave(fixture?.game));
  return { db, ...(await mainFlowSession(saves, fixture)) };
}

function authoredFixture() {
  const loaded = loadSplitContentPackage(
    ["game.json", "locales/zh-CN.json", "locales/en-US.json"].map((source) => ({
      source,
      text: readFileSync(
        new URL(`../../content/mainflow-short/0.1.0/${source}`, import.meta.url),
        "utf8",
      ),
    })),
    { expectedPackageId: "mainflow-short", expectedVersion: "0.1.0" },
  );
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues));
  return { game: loaded.gameContent, localizations: loaded.localizations };
}

describe("main flow atomic SQLite persistence", () => {
  it("never publishes a candidate when real SQLite rejects the write", async () => {
    const fixture = authoredFixture();
    const { db, session, saves } = await setup(fixture);
    const before = session.getSnapshot().envelope;
    const observed: unknown[] = [];
    const unsubscribe = session.subscribe(() => observed.push(session.getSnapshot().state));
    db.database.native.exec("PRAGMA query_only = ON");
    const result = await session.dispatch({
      type: "replyChat",
      instanceId: "instance-a",
      nodeId: "hello",
      replyId: "ack",
    });
    unsubscribe();
    expect(result).toMatchObject({ ok: false, code: "RELOAD_REQUIRED" });
    expect(session.getSnapshot().envelope).toEqual(before);
    expect(observed.length).toBeGreaterThan(0);
    for (const state of observed) expect(state).toEqual(before!.state);
    expect(await saves.load("main-save", "main-profile")).toEqual(before);
    const reopened = await mainFlowSession(new SqliteSaveRepository(db.openConnection()), fixture);
    expect(reopened.session.getSnapshot().envelope).toEqual(before);
  });

  it("reopens the generated package after a reply, during a case, and at an unfinished news action checkpoint", async () => {
    const fixture = authoredFixture();
    const { db, session: initialSession } = await setup(fixture);
    let session = initialSession;
    const send = async (command: GameCommand) =>
      expect(await session.dispatch(command)).toMatchObject({ ok: true });
    const reopen = async () => {
      const before = session.getSnapshot().envelope;
      session = (await mainFlowSession(new SqliteSaveRepository(db.openConnection()), fixture))
        .session;
      expect(session.getSnapshot().envelope).toEqual(before);
    };
    await send({ type: "replyChat", instanceId: "instance-a", nodeId: "hello", replyId: "ack" });
    await reopen();
    expect(session.getSnapshot().state!.mainFlow!.chats["instance-a"]).toMatchObject({
      currentNodeId: "detail",
      history: [{ nodeId: "hello", replyId: "ack" }],
    });
    await send({ type: "startCase", caseId: "case-a" });
    await send({
      type: "chooseOption",
      caseId: "case-a",
      nodeId: "case-a-1",
      choiceId: "case-a-choose-1",
    });
    await reopen();
    expect(session.getSnapshot().state!.cases["case-a"]).toMatchObject({
      currentNodeId: "case-a-2",
    });
    await send({ type: "readNews", newsId: "news-n" });
    await send({ type: "submitStoryInput", storyId: "news-ack", stepId: "ack", actionId: "wave" });
    await reopen();
    expect(session.getSnapshot().state!.storyCheckpoint).toMatchObject({
      storyId: "news-ack",
      resumeStepId: "ack",
    });
    expect(session.getSnapshot().state!.completedStoryIds).not.toContain("news-ack");
    await send({
      type: "submitStoryInput",
      storyId: "news-ack",
      stepId: "ack",
      actionId: "salute",
    });
    expect(session.getSnapshot().state!.completedStoryIds).toContain("news-ack");
  });
  it("commits case choice, two threshold results and follow-up dispatch together and restores without replay", async () => {
    const { db, session, saves } = await setup();
    await session.dispatch({ type: "startCase", caseId: "intake" });
    await session.dispatch(mainFlowChoices[0]);
    await session.dispatch(mainFlowChoices[1]);
    const saved = await saves.load("main-save", "main-profile");
    expect(saved!.state.mainFlow!.chatResults).toMatchObject({
      a: { reason: "inactivity" },
      b: { reason: "inactivity" },
    });
    expect(Object.keys(saved!.state.mainFlow!.chats)).toEqual(["c"]);
    expect(saved!.state.mainFlow!.dispatches).toHaveLength(2);
    const reopened = await mainFlowSession(new SqliteSaveRepository(db.openConnection()));
    expect(reopened.session.getSnapshot().state).toEqual(saved!.state);
    expect(reopened.session.getSnapshot().envelope!.revision).toBe(saved!.revision);
  });

  it("does not publish a losing reply or reset after another session commits", async () => {
    const { db, session, saves } = await setup();
    await session.dispatch({ type: "startCase", caseId: "intake" });
    const other = await mainFlowSession(new SqliteSaveRepository(db.openConnection()));
    await session.dispatch(mainFlowChoices[0]);
    const before = other.session.getSnapshot().state;
    const lost = await other.session.dispatch({
      type: "replyChat",
      instanceId: "a",
      nodeId: "hello",
      replyId: "reply",
    });
    expect(lost).toMatchObject({ ok: false, code: "REVISION_CONFLICT" });
    expect(other.session.getSnapshot().state).toEqual(before);
    expect((await saves.load("main-save", "main-profile"))!.state.mainFlow!.chats.a).toMatchObject({
      history: [],
      inactivityChoices: 1,
    });
    await other.session.reload();
    expect(other.session.getSnapshot().state).toEqual(session.getSnapshot().state);
  });

  it("reads a v4 row without adding flow or rebinding and upgrades only on CAS", async () => {
    const { db, saves } = await setup();
    const old = pilotSave();
    db.database.native
      .prepare("INSERT INTO saves VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        "old-save",
        "main-profile",
        0,
        4,
        old.contentRef.packageId,
        old.contentRef.version,
        JSON.stringify(old.state),
        MAIN_FLOW_NOW,
        MAIN_FLOW_NOW,
      );
    const before = db.database.native.prepare("SELECT * FROM saves WHERE save_id='old-save'").get();
    const loaded = await saves.load("old-save", "main-profile");
    expect(loaded!.saveSchemaVersion).toBe(5);
    expect(loaded!.state.mainFlow).toBeUndefined();
    expect(
      db.database.native.prepare("SELECT * FROM saves WHERE save_id='old-save'").get(),
    ).toEqual(before);
    await saves.commit({
      saveId: "old-save",
      profileId: "main-profile",
      expectedRevision: 0,
      nextState: loaded!.state,
      updatedAt: MAIN_FLOW_NOW,
    });
    expect(await saves.load("old-save", "main-profile")).toMatchObject({
      saveSchemaVersion: 5,
      contentRef: old.contentRef,
      state: old.state,
    });
    expect(
      db.database.native
        .prepare("SELECT save_schema_version FROM saves WHERE save_id='old-save'")
        .get()!.save_schema_version,
    ).toBe(5);
  });

  it("backfills existing accounts and creates new tutorial rows atomically", async () => {
    const native = new DatabaseSync(":memory:");
    try {
      native.exec(
        readFileSync(
          new URL("../../src-tauri/migrations/001_initial.sql", import.meta.url),
          "utf8",
        ),
      );
      native
        .prepare("INSERT INTO profiles VALUES (?, ?, ?, ?)")
        .run("old", "old", "Old", MAIN_FLOW_NOW);
      native.exec(
        readFileSync(
          new URL("../../src-tauri/migrations/002_profile_tutorials.sql", import.meta.url),
          "utf8",
        ),
      );
      const profiles = new SqliteProfileRepository(new NodeSqliteTestDatabase(native));
      expect(await profiles.getTutorialCompleted("old")).toBe(true);
      await profiles.create({
        profileId: "new",
        loginName: "new",
        displayName: "New",
        createdAt: MAIN_FLOW_NOW,
      });
      expect(await profiles.getTutorialCompleted("new")).toBe(false);
      await profiles.markTutorialCompleted("new");
      expect(await profiles.getTutorialCompleted("new")).toBe(true);
    } finally {
      native.close();
    }
  });
});
