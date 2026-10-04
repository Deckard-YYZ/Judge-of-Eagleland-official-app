import { describe, expect, it, vi } from "vitest";
import {
  mainFlowChoices,
  mainFlowFixture,
  mainFlowSave,
  mainFlowSession,
} from "../fixtures/mainFlow";
import { InMemorySaveRepository } from "../../src/storage/inMemorySaveRepository";
import { checkGameStateInvariants } from "../../src/game/invariants";

describe("committed main-flow and parallel chats", () => {
  it("counts each choice once, resets only the replied instance, publishes results and dispatches atomically", async () => {
    const { session } = await mainFlowSession();
    expect(await session.dispatch({ type: "startCase", caseId: "intake" })).toMatchObject({
      ok: true,
    });
    expect(session.getSnapshot().state!.mainFlow!.chats.a.inactivityChoices).toBe(0);
    expect(await session.dispatch(mainFlowChoices[0])).toMatchObject({ ok: true });
    expect(
      await session.dispatch({
        type: "replyChat",
        instanceId: "a",
        nodeId: "hello",
        replyId: "reply",
      }),
    ).toMatchObject({ ok: true });
    let flow = session.getSnapshot().state!.mainFlow!;
    expect(flow.chats.a).toMatchObject({
      currentNodeId: "question",
      inactivityChoices: 0,
      history: [{ nodeId: "hello", replyId: "reply" }],
    });
    expect(flow.chats.b).toMatchObject({ currentNodeId: "hello", inactivityChoices: 1 });
    expect(flow.currentNodeId).toBe("start");
    await session.reload();
    expect(session.getSnapshot().state!.mainFlow).toEqual(flow);
    expect(await session.dispatch(mainFlowChoices[1])).toMatchObject({ ok: true });
    flow = session.getSnapshot().state!.mainFlow!;
    expect(flow.chats.a.inactivityChoices).toBe(1);
    expect(flow.chats.b).toBeUndefined();
    expect(flow.chatResults.b).toMatchObject({
      resultId: "ignored",
      reason: "inactivity",
      terminalNodeId: null,
    });
    expect(await session.dispatch(mainFlowChoices[2])).toMatchObject({ ok: true });
    flow = session.getSnapshot().state!.mainFlow!;
    expect(flow.currentNodeId).toBe("done");
    expect(flow.chatResults.a).toMatchObject({ resultId: "ignored" });
    expect(flow.chats.c.inactivityChoices).toBe(0);
    expect(flow.dispatches).toEqual([
      { nodeId: "start", caseId: "intake" },
      { nodeId: "done", caseId: "followup" },
    ]);
    expect(session.getSnapshot().state!.cases.followup.status).toBe("pending");
    await session.reload();
    expect(session.getSnapshot().state!.mainFlow).toEqual(flow);
    expect(await session.dispatch(mainFlowChoices[2])).toMatchObject({ ok: false });
    expect(session.getSnapshot().state!.mainFlow).toEqual(flow);
  });

  it("only a terminal reply publishes a normal result; unfinished replies cannot advance the main graph", async () => {
    const { session } = await mainFlowSession();
    await session.dispatch({
      type: "replyChat",
      instanceId: "a",
      nodeId: "hello",
      replyId: "reply",
    });
    expect(session.getSnapshot().state!.mainFlow!.currentNodeId).toBe("start");
    expect(
      await session.dispatch({
        type: "replyChat",
        instanceId: "a",
        nodeId: "hello",
        replyId: "reply",
      }),
    ).toMatchObject({ code: "STALE_CHAT_REPLY" });
    await session.dispatch({
      type: "replyChat",
      instanceId: "a",
      nodeId: "question",
      replyId: "yes",
    });
    expect(session.getSnapshot().state!.mainFlow!.chatResults.a).toEqual({
      chatId: "clerk",
      resultId: "accepted",
      terminalNodeId: "end",
      reason: "normal",
    });
    expect(session.getSnapshot().state!.mainFlow!.currentNodeId).toBe("done");
    expect(session.getSnapshot().state!.phase.type).toBe("playing");
  });

  it("does not publish a threshold result or case choice when the atomic save fails", async () => {
    const saves = new InMemorySaveRepository([mainFlowSave()]);
    const { session } = await mainFlowSession(saves);
    await session.dispatch({ type: "startCase", caseId: "intake" });
    await session.dispatch(mainFlowChoices[0]);
    const before = session.getSnapshot().state;
    vi.spyOn(saves, "commit").mockRejectedValueOnce(new Error("disk failed"));
    expect(await session.dispatch(mainFlowChoices[1])).toMatchObject({ ok: false });
    expect(session.getSnapshot().state).toEqual(before);
    expect((await saves.load("main-save", "main-profile"))!.state).toEqual(before);
  });

  it("saves news reading and its mandatory action once, without changing any chat counter", async () => {
    const { session } = await mainFlowSession();
    expect(await session.dispatch({ type: "readNews", newsId: "notice" })).toMatchObject({
      ok: true,
    });
    expect(session.getSnapshot().state!.pendingStoryIds).toEqual(["judgment_notice"]);
    expect(
      await session.dispatch({
        type: "replyChat",
        instanceId: "a",
        nodeId: "hello",
        replyId: "reply",
      }),
    ).toMatchObject({ code: "STORY_BLOCKING" });
    expect(await session.dispatch({ type: "readNews", newsId: "notice" })).toMatchObject({
      code: "STORY_BLOCKING",
    });
    expect(session.getSnapshot().state!.mainFlow!.chats.a.inactivityChoices).toBe(0);
    await session.reload();
    expect(
      await session.dispatch({ type: "completeStory", storyId: "judgment_notice" }),
    ).toMatchObject({ code: "STORY_INPUT_REQUIRED" });
    await session.dispatch({
      type: "submitStoryInput",
      storyId: "judgment_notice",
      stepId: "required_action",
      actionId: "salute",
    });
    expect(await session.dispatch({ type: "readNews", newsId: "notice" })).toMatchObject({
      code: "NEWS_ALREADY_READ",
    });
    expect(session.getSnapshot().state!.mainFlow!.readNewsIds).toEqual(["notice"]);
  });

  it("dismisses only the configured tutorial including its checkpoint", async () => {
    const fixture = mainFlowFixture();
    const save = mainFlowSave(fixture.game);
    save.state.pendingStoryIds = ["tutorial"];
    const { session } = await mainFlowSession(new InMemorySaveRepository([save]), fixture);
    expect(
      await session.dispatch({ type: "dismissTutorial", storyId: "judgment_notice" }),
    ).toMatchObject({ code: "INVALID_TUTORIAL_DISMISSAL" });
    expect(await session.dispatch({ type: "dismissTutorial", storyId: "tutorial" })).toMatchObject({
      ok: true,
    });
    expect(session.getSnapshot().state).toMatchObject({
      pendingStoryIds: [],
      completedStoryIds: ["tutorial"],
      storyCheckpoint: null,
    });
    await session.reload();
    expect(session.getSnapshot().state!.pendingStoryIds).toEqual([]);
  });

  it("rejects corrupted active paths and fabricated results", () => {
    const fixture = mainFlowFixture();
    const state = mainFlowSave(fixture.game).state;
    state.mainFlow!.chats.a.currentNodeId = "question";
    expect(checkGameStateInvariants(state, fixture.game).ok).toBe(false);
    state.mainFlow!.chats.a.currentNodeId = "hello";
    state.mainFlow!.chatResults.a = {
      chatId: "clerk",
      resultId: "accepted",
      terminalNodeId: null,
      reason: "inactivity",
    };
    expect(checkGameStateInvariants(state, fixture.game).ok).toBe(false);
  });

  it("records transition conflicts without choosing a branch or losing the successful verdict", async () => {
    const fixture = mainFlowFixture();
    fixture.game.mainFlow!.nodes.start.transitions = ["left", "right"].map((id) => ({
      id,
      targetNodeId: "done",
      when: { all: [{ type: "caseResolved" as const, caseId: "intake" }] },
    }));
    const { session } = await mainFlowSession(undefined, fixture);
    await session.dispatch({ type: "startCase", caseId: "intake" });
    for (const command of mainFlowChoices)
      expect(await session.dispatch(command)).toMatchObject({ ok: true });
    expect(session.getSnapshot().state!.cases.intake.status).toBe("resolved");
    expect(session.getSnapshot().state!.cases.followup).toBeUndefined();
    expect(session.getSnapshot().state!.mainFlow!.needsDecision).toEqual({
      reason: "transitionConflict",
      nodeId: "start",
      candidateIds: ["left", "right"],
    });
  });

  it("retains an explicit empty-pool decision across later replies and never treats it as an ending", async () => {
    const fixture = mainFlowFixture();
    fixture.game.mainFlow!.casePools.next.members[0].when = {
      all: [{ type: "resolvedCountAtLeast", count: 100 }],
    };
    const { session } = await mainFlowSession(undefined, fixture);
    for (const instanceId of ["a", "b"]) {
      await session.dispatch({ type: "replyChat", instanceId, nodeId: "hello", replyId: "reply" });
      await session.dispatch({ type: "replyChat", instanceId, nodeId: "question", replyId: "yes" });
    }
    expect(session.getSnapshot().state!.mainFlow!.needsDecision).toEqual({
      reason: "emptyPool",
      nodeId: "done",
      candidateIds: [],
    });
    expect(session.getSnapshot().state!.cases.followup).toBeUndefined();
    expect(session.getSnapshot().state!.phase.type).toBe("playing");
  });
});
