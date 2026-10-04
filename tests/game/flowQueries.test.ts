import { describe, expect, it } from "vitest";
import {
  validateGameContentCatalog,
  validateLocalizedContentCatalog,
} from "../../src/content/validate";
import type { FlowCondition, GameContentCatalog } from "../../src/content/schema";
import { createInitialGameState } from "../../src/game/initialization";
import {
  queryCaseCharacters,
  queryChatAvailability,
  queryChatNode,
  queryFlowEvent,
  queryStageTransitions,
  queryChatExternalEvent,
} from "../../src/application/configurationQueries";
import { InMemorySaveRepository } from "../../src/storage/inMemorySaveRepository";
import { createGameContentView } from "../../src/application/gameContentView";
import {
  COMPLETE_GAME,
  COMPLETE_LOCALES,
  COMPLETE_INVENTORY,
} from "../fixtures/configurationComplete";
import {
  pilotSave,
  pilotSession,
  preparePilotVerdict,
  pilotVerdict,
  pilotInput,
} from "../fixtures/configurationPilot";

const initial = () => {
  const result = createInitialGameState(COMPLETE_GAME);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.state;
};
const facts = (currentStageId = "registration", lastChatNodeIds: Record<string, string> = {}) => ({
  currentStageId,
  lastChatNodeIds,
});
const copy = () => structuredClone(COMPLETE_GAME) as GameContentCatalog;
const active = (chatId: string, nodeId: string, currentStageId = "review") => ({
  ...facts(currentStageId),
  activeChatNodeIds: { [chatId]: nodeId },
});
const authority = (value: number): FlowCondition => ({
  all: [{ type: "attributeAtLeast", attributeId: "authority", value }],
});
const must = <T>(result: { ok: true; value: T } | { ok: false; issues: unknown }): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
};

describe("complete configuration: finite read-only stage/chat queries", () => {
  it("keeps an activated held chat usable after stage eligibility changes and matches committed hidden branches without resolving reply races", async () => {
    const game = copy();
    const chat = game.configuration!.flow!.chats.clerk_intro;
    chat.when = { all: [{ type: "currentStage", stageId: "registration" }] };
    const greeting = chat.nodes.greeting;
    if (greeting.type !== "message") throw new Error("Expected message.");
    const event = { type: "caseResolved", caseId: "intake", resolutionId: "approved" } as const;
    greeting.externalBranches = [
      { id: "after_verdict", event, when: authority(1), targetNodeId: "done", consequences: [] },
    ];
    expect(
      must(queryChatAvailability(initial(), game, facts())).find(
        (entry) => entry.chatId === "clerk_intro",
      )?.condition.matches,
    ).toBe(true);
    const { session } = await pilotSession(
      new InMemorySaveRepository([pilotSave(game)]),
      game,
      COMPLETE_LOCALES,
    );
    await preparePilotVerdict(session);
    await session.dispatch(pilotVerdict);
    const state = session.getSnapshot().state!;
    const supplied = active("clerk_intro", "greeting", "review");
    const before = JSON.stringify(session.getSnapshot());
    expect(
      must(queryChatAvailability(state, game, supplied)).find(
        (entry) => entry.chatId === "clerk_intro",
      )?.condition.matches,
    ).toBe(false);
    expect(must(queryChatNode(state, game, supplied, "clerk_intro", "greeting"))).toMatchObject({
      status: "replies",
      availability: { matches: false },
    });
    expect(
      must(queryChatExternalEvent(state, game, supplied, "clerk_intro", "greeting", event))
        .decision,
    ).toEqual({
      status: "matched",
      branchId: "after_verdict",
      targetNodeId: "done",
      consequences: [],
    });
    expect(
      must(
        queryChatExternalEvent(state, game, supplied, "clerk_intro", "greeting", {
          type: "caseStarted",
          caseId: "intake",
        }),
      ).decision,
    ).toEqual({ status: "needsDecision", reason: "noMatch", branchIds: [] });
    expect(
      queryChatExternalEvent(state, game, supplied, "clerk_intro", "greeting", {
        type: "caseResolved",
        caseId: "followup",
        resolutionId: "followup_closed",
      }).ok,
    ).toBe(false);
    greeting.externalBranches.push({
      ...greeting.externalBranches[0],
      id: "second_branch",
      targetNodeId: "details",
    });
    expect(
      must(queryChatExternalEvent(state, game, supplied, "clerk_intro", "greeting", event))
        .decision,
    ).toEqual({
      status: "needsDecision",
      reason: "conflict",
      branchIds: ["after_verdict", "second_branch"],
    });
    expect(JSON.stringify(session.getSnapshot())).toBe(before);
  });

  it("queries the full authored hidden caseResolved branch after real follow-up gameplay without mutating chat or save", async () => {
    const { session } = await pilotSession(
      new InMemorySaveRepository([pilotSave(COMPLETE_GAME)]),
      COMPLETE_GAME,
      COMPLETE_LOCALES,
    );
    await preparePilotVerdict(session);
    await session.dispatch(pilotVerdict);
    await session.dispatch(pilotInput("salute"));
    await session.dispatch({ type: "startCase", caseId: "followup" });
    await session.dispatch({
      type: "chooseOption",
      caseId: "followup",
      nodeId: "followup_judgment",
      choiceId: "finish_followup",
    });
    const state = session.getSnapshot().state!;
    const before = JSON.stringify(session.getSnapshot());
    const result = must(
      queryChatExternalEvent(
        state,
        COMPLETE_GAME,
        active("clerk_intro", "greeting", "completed"),
        "clerk_intro",
        "greeting",
        { type: "caseResolved", caseId: "followup", resolutionId: "followup_closed" },
      ),
    );
    expect(result.decision).toEqual({
      status: "matched",
      branchId: "followup_received",
      targetNodeId: "done",
      consequences: [{ type: "unlockChats", chatIds: ["appeal_chat"] }],
    });
    expect(result.availability.matches).toBe(false);
    expect(JSON.stringify(session.getSnapshot())).toBe(before);
  });
  it("loads two locales and real media, reuses case characters, and exposes explicit portrait references", () => {
    expect(
      validateGameContentCatalog(COMPLETE_GAME, { fileInventory: COMPLETE_INVENTORY }).ok,
    ).toBe(true);
    for (const localized of Object.values(COMPLETE_LOCALES))
      expect(validateLocalizedContentCatalog(localized, COMPLETE_GAME).ok).toBe(true);
    expect(must(queryCaseCharacters(COMPLETE_GAME, "intake"))).toEqual([
      {
        id: "clerk",
        portraitAssetId: "portrait",
        portrait: { assetId: "portrait", kind: "image", path: "media/portrait.png" },
      },
    ]);
    const view = createGameContentView(COMPLETE_GAME, COMPLETE_LOCALES["en-US"]);
    expect(view.cases.intake.characters[0]).toMatchObject({ id: "clerk", name: "Clerk" });
  });

  it("queries a real verdict without implicitly advancing or saving flow facts", async () => {
    const saves = new InMemorySaveRepository([pilotSave(COMPLETE_GAME)]);
    const { session } = await pilotSession(saves, COMPLETE_GAME, COMPLETE_LOCALES);
    expect(must(queryStageTransitions(initial(), COMPLETE_GAME, facts())).decision).toEqual({
      status: "needsDecision",
      reason: "noMatch",
      transitionIds: [],
    });
    await preparePilotVerdict(session);
    const committed = await session.dispatch(pilotVerdict);
    expect(committed.ok).toBe(true);
    const state = session.getSnapshot().state!;
    const before = JSON.stringify(session.getSnapshot());
    const result = must(queryStageTransitions(state, COMPLETE_GAME, facts()));
    expect(result.decision).toEqual({
      status: "matched",
      transitionId: "review_after_verdict",
      targetStageId: "review",
    });
    expect(
      result.candidates.find((candidate) => candidate.id === "appeal_qualified")?.condition
        .predicates[0].matches,
    ).toBe(false);
    expect(JSON.stringify(session.getSnapshot())).toBe(before);
    expect(state).not.toHaveProperty("currentStageId");
    expect(state).not.toHaveProperty("lastChatNodeIds");
    expect(state.cases.followup).toEqual({ status: "pending" });
  });

  it("explains all/any, missing prior chat facts, and authored branching without assigning chat order", () => {
    const state = {
      ...initial(),
      attributes: { ...initial().attributes, authority: 1 },
      flags: { ...initial().flags, judged: true },
    };
    const registration = must(queryChatAvailability(state, COMPLETE_GAME, facts()));
    expect(registration.find((entry) => entry.chatId === "clerk_intro")?.condition.matches).toBe(
      false,
    );
    const review = must(queryChatAvailability(state, COMPLETE_GAME, facts("review")));
    expect(review.find((entry) => entry.chatId === "clerk_intro")?.condition).toMatchObject({
      operator: "all",
      matches: true,
    });
    expect(review.find((entry) => entry.chatId === "appeal_chat")?.condition).toMatchObject({
      operator: "any",
      matches: false,
    });
    const completedChat = must(
      queryChatAvailability(state, COMPLETE_GAME, facts("review", { clerk_intro: "done" })),
    );
    expect(completedChat.find((entry) => entry.chatId === "appeal_chat")?.condition).toMatchObject({
      operator: "any",
      matches: true,
    });
    expect(must(queryStageTransitions(state, COMPLETE_GAME, facts("completed"))).decision).toEqual({
      status: "terminal",
    });
  });

  it("returns reply candidates, local terminal and external-event intents while leaving all inputs untouched", () => {
    const state = {
      ...initial(),
      attributes: { ...initial().attributes, authority: 1 },
      flags: { ...initial().flags, judged: true },
    };
    const supplied = active("clerk_intro", "greeting");
    const before = JSON.stringify({ state, supplied, game: COMPLETE_GAME });
    const node = must(queryChatNode(state, COMPLETE_GAME, supplied, "clerk_intro", "greeting"));
    expect(node).toMatchObject({
      status: "replies",
      replies: [
        { id: "accept", eligible: true },
        { id: "ask", eligible: true },
        {
          id: "schedule",
          eligible: true,
          eventEligibility: { matches: true },
          eventTargets: { eligible: true },
        },
      ],
    });
    expect(
      must(
        queryChatNode(state, COMPLETE_GAME, active("clerk_intro", "done"), "clerk_intro", "done"),
      ),
    ).toMatchObject({
      status: "terminal",
      consequences: [{ type: "unlockChats", chatIds: ["appeal_chat"] }],
    });
    expect(must(queryFlowEvent(state, COMPLETE_GAME, supplied, "schedule_followup"))).toMatchObject(
      {
        status: "matched",
        consequences: [
          { type: "unlockCases", caseIds: ["followup"] },
          { type: "enterStage", stageId: "review" },
        ],
      },
    );
    expect(JSON.stringify({ state, supplied, game: COMPLETE_GAME })).toBe(before);
  });

  it("keeps empty/conflicting stage matches explicit and never chooses the first authored transition", () => {
    const game = copy();
    const stage = game.configuration!.flow!.stages.registration;
    stage.transitions = [
      { id: "first", when: authority(0), targetStageId: "registration" },
      { id: "second", when: authority(0), targetStageId: "registration" },
    ];
    expect(must(queryStageTransitions(initial(), game, facts())).decision).toEqual({
      status: "needsDecision",
      reason: "conflict",
      transitionIds: ["first", "second"],
    });
    stage.transitions = [{ id: "unmet", when: authority(9), targetStageId: "registration" }];
    const result = must(queryStageTransitions(initial(), game, facts()));
    expect(result.decision).toEqual({
      status: "needsDecision",
      reason: "noMatch",
      transitionIds: [],
    });
    expect(result.candidates[0].condition).toMatchObject({
      matches: false,
      predicates: [{ matches: false }],
    });
  });

  it("reports unavailable chats/replies/events and rejects unqualified stage consequences", () => {
    expect(
      must(queryChatNode(initial(), COMPLETE_GAME, facts(), "clerk_intro", "greeting")),
    ).toMatchObject({ status: "needsDecision", reason: "chatNotActive" });
    expect(
      must(queryFlowEvent(initial(), COMPLETE_GAME, facts(), "schedule_followup")),
    ).toMatchObject({ status: "needsDecision", reason: "conditionUnmet", consequences: [] });
    const game = copy();
    game.configuration!.flow!.chats.clerk_intro.when = authority(0);
    const greeting = game.configuration!.flow!.chats.clerk_intro.nodes.greeting;
    if (greeting.type !== "message") throw new Error("Expected message.");
    for (const reply of greeting.replies) reply.when = authority(9);
    expect(
      must(
        queryChatNode(
          initial(),
          game,
          active("clerk_intro", "greeting"),
          "clerk_intro",
          "greeting",
        ),
      ),
    ).toMatchObject({
      status: "needsDecision",
      reason: "noAvailableReplies",
    });
    game.configuration!.flow!.events.schedule_followup.when = authority(0);
    expect(must(queryFlowEvent(initial(), game, facts(), "schedule_followup"))).toMatchObject({
      status: "needsDecision",
      reason: "targetStageUnavailable",
      eligibility: { eligible: false },
      consequences: [],
    });
    const done = game.configuration!.flow!.chats.clerk_intro.nodes.done;
    if (done.type !== "terminal") throw new Error("Expected terminal.");
    done.consequences = [{ type: "enterStage", stageId: "completed" }];
    expect(
      must(queryChatNode(initial(), game, active("clerk_intro", "done"), "clerk_intro", "done")),
    ).toMatchObject({
      status: "needsDecision",
      reason: "targetStageUnavailable",
      consequences: [],
    });
  });

  it("diagnoses prototype-named bad references in queries and configuration rather than throwing", () => {
    for (const bad of ["toString", "constructor"]) {
      expect(queryStageTransitions(initial(), COMPLETE_GAME, facts(bad)).ok).toBe(false);
      expect(
        queryStageTransitions(initial(), COMPLETE_GAME, facts("review", { [bad]: "done" })).ok,
      ).toBe(false);
      expect(queryChatNode(initial(), COMPLETE_GAME, facts(), bad, "done").ok).toBe(false);
      expect(queryFlowEvent(initial(), COMPLETE_GAME, facts(), bad).ok).toBe(false);
      expect(queryCaseCharacters(COMPLETE_GAME, bad).ok).toBe(false);
      const game = copy();
      game.configuration!.flow!.stages.registration.transitions[0].targetStageId = bad;
      game.configuration!.flow!.events.schedule_followup.consequences = [
        { type: "unlockChats", chatIds: [bad] },
      ];
      game.cases.intake.characters[0].portraitAssetId = bad;
      expect(() => validateGameContentCatalog(game)).not.toThrow();
      expect(validateGameContentCatalog(game).ok).toBe(false);
      expect(() => queryStageTransitions(initial(), game, facts())).not.toThrow();
      expect(queryStageTransitions(initial(), game, facts()).ok).toBe(false);
    }
  });

  it("validates local graph targets, reachability and routes to terminal/external exits", () => {
    const game = copy();
    const chat = game.configuration!.flow!.chats.clerk_intro;
    const greeting = chat.nodes.greeting;
    if (greeting.type !== "message") throw new Error("Expected message.");
    greeting.replies[0].target = { type: "node", nodeId: "notice" }; // Belongs to the other chat.
    chat.nodes.orphan = { type: "terminal", consequences: [] };
    chat.nodes.details = {
      type: "message",
      replies: [{ id: "repeat", when: authority(0), target: { type: "node", nodeId: "details" } }],
    };
    const result = validateGameContentCatalog(game);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected graph diagnostics.");
    expect(result.issues.map((issue) => issue.message).join(" ")).toContain("this chat");
    expect(result.issues.map((issue) => issue.message).join(" ")).toContain("unreachable");
    expect(result.issues.map((issue) => issue.message).join(" ")).toContain("no route");
  });

  it("requires exact stage, chat, terminal and reply coverage in both locales", () => {
    for (const localized of Object.values(COMPLETE_LOCALES)) {
      const broken = structuredClone(localized);
      delete broken.flow!.stages.registration;
      delete broken.flow!.chats.clerk_intro.nodes.done;
      delete broken.flow!.chats.clerk_intro.nodes.greeting.replies.accept;
      broken.flow!.chats.clerk_intro.nodes.details.replies.extra = { text: "unexpected" };
      const result = validateLocalizedContentCatalog(broken, COMPLETE_GAME);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected localization diagnostics.");
      expect(
        result.issues.filter((issue) => issue.code === "LOCALIZATION_ID_MISSING"),
      ).toHaveLength(3);
      expect(result.issues.some((issue) => issue.code === "LOCALIZATION_ID_EXTRA")).toBe(true);
    }
  });

  it("rejects interactionOnly reads in every new rule site and unsupported consequence effects", () => {
    const writes: ((game: GameContentCatalog, condition: FlowCondition) => void)[] = [
      (game, condition) => {
        game.configuration!.flow!.stages.review.when = condition;
      },
      (game, condition) => {
        game.configuration!.flow!.stages.registration.transitions[0].when = condition;
      },
      (game, condition) => {
        game.configuration!.flow!.chats.clerk_intro.when = condition;
      },
      (game, condition) => {
        const node = game.configuration!.flow!.chats.clerk_intro.nodes.greeting;
        if (node.type === "message") node.replies[0].when = condition;
      },
      (game, condition) => {
        game.configuration!.flow!.events.schedule_followup.when = condition;
      },
      (game, condition) => {
        const node = game.configuration!.flow!.chats.clerk_intro.nodes.greeting;
        if (node.type === "message") node.externalBranches![0].when = condition;
      },
    ];
    for (const write of writes)
      for (const condition of [
        { all: [{ type: "attributeAtLeast", attributeId: "input_errors", value: 0 }] },
        { any: [{ type: "flagEquals", flagId: "action_mistake", value: false }] },
      ] satisfies FlowCondition[]) {
        const game = copy();
        write(game, condition);
        const result = validateGameContentCatalog(game);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("Expected isolation diagnostics.");
        expect(result.issues.some((issue) => issue.message.includes("interactionOnly"))).toBe(true);
        expect(queryStageTransitions(initial(), game, facts()).ok).toBe(false);
      }
    const game = copy();
    Reflect.set(game.configuration!.flow!.events.schedule_followup, "consequences", [
      { type: "setFlag", flagId: "action_mistake", value: true },
    ]);
    expect(validateGameContentCatalog(game).ok).toBe(false);
    const branchGame = copy();
    const branchNode = branchGame.configuration!.flow!.chats.clerk_intro.nodes.greeting;
    if (branchNode.type !== "message") throw new Error("Expected message.");
    Reflect.set(branchNode.externalBranches![0], "consequences", [
      { type: "attributeDelta", attributeId: "input_errors", amount: 1 },
    ]);
    expect(validateGameContentCatalog(branchGame).ok).toBe(false);
  });

  it("does not accept mixed condition operators, script payloads, forged flow facts or implicit stage targets", () => {
    const game = copy();
    Reflect.set(game.configuration!.flow!.stages.review, "when", {
      all: [{ type: "resolvedCountAtLeast", count: 0 }],
      any: [{ type: "resolvedCountAtLeast", count: 0 }],
    });
    expect(validateGameContentCatalog(game).ok).toBe(false);
    expect(
      queryStageTransitions(initial(), COMPLETE_GAME, { ...facts(), script: "advance()" }).ok,
    ).toBe(false);
    const conflict = copy();
    conflict.configuration!.flow!.events.schedule_followup.consequences = [
      { type: "enterStage", stageId: "review" },
      { type: "enterStage", stageId: "appeal" },
    ];
    expect(validateGameContentCatalog(conflict).ok).toBe(false);
  });
});
