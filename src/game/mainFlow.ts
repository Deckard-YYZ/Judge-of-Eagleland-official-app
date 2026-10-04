import type { GameContentCatalog, MainFlowCondition } from "../content/schema";
import type { GameCommand, TransitionResult } from "./commands";
import type { GameState, MainFlowState } from "./model";

/** Evaluates only committed business facts or the candidate facts of one atomic command. */
export function matchesMainFlowCondition(
  state: Readonly<GameState>,
  condition: MainFlowCondition,
): boolean {
  const predicates = "all" in condition ? condition.all : condition.any;
  const matches = predicates.map((predicate) => {
    switch (predicate.type) {
      case "mainNode":
        return state.mainFlow!.currentNodeId === predicate.nodeId;
      case "chatResult":
        return state.mainFlow!.chatResults[predicate.instanceId]?.resultId === predicate.resultId;
      case "caseResolved": {
        const progress = state.cases[predicate.caseId];
        return (
          progress?.status === "resolved" &&
          (predicate.resolutionId === undefined || progress.resolutionId === predicate.resolutionId)
        );
      }
      case "resolvedCountAtLeast":
        return (
          Object.values(state.cases).filter((progress) => progress.status === "resolved").length >=
          predicate.count
        );
      case "attributeAtLeast":
        return state.attributes[predicate.attributeId] >= predicate.value;
      case "attributeAtMost":
        return state.attributes[predicate.attributeId] <= predicate.value;
      case "flagEquals":
        return state.flags[predicate.flagId] === predicate.value;
    }
  });
  return "all" in condition ? matches.every(Boolean) : matches.some(Boolean);
}

function finishChat(
  state: MainFlowState,
  instanceId: string,
  resultId: string,
  terminalNodeId: string | null,
): void {
  const chat = state.chats[instanceId];
  state.chatResults[instanceId] = {
    chatId: chat.chatId,
    resultId,
    terminalNodeId,
    reason: terminalNodeId === null ? "inactivity" : "normal",
  };
  delete state.chats[instanceId];
}

/** Mutates only the newly allocated candidate. Authored DAGs make this walk finite. */
function advance(state: GameState, content: Readonly<GameContentCatalog>): void {
  const definition = content.mainFlow!;
  const flow = state.mainFlow!;
  // Empty-pool policy is unresolved; later commands cannot silently consume its failed intent.
  if (flow.needsDecision?.reason === "emptyPool") return;
  flow.needsDecision = null;
  for (;;) {
    const nodeId = flow.currentNodeId;
    const node = definition.nodes[nodeId];
    if (!flow.enteredNodeIds.includes(nodeId)) {
      flow.enteredNodeIds.push(nodeId);
      for (const intent of node.onEnter) {
        switch (intent.type) {
          case "openPool":
            if (!flow.openPoolIds.includes(intent.poolId)) flow.openPoolIds.push(intent.poolId);
            break;
          case "publishNews":
            if (!flow.publishedNewsIds.includes(intent.newsId))
              flow.publishedNewsIds.push(intent.newsId);
            break;
          case "startChat": {
            const chat = definition.chats[intent.chatId];
            flow.chats[intent.instanceId] = {
              chatId: intent.chatId,
              currentNodeId: chat.startNodeId,
              history: [],
              inactivityChoices: 0,
            };
            const start = chat.nodes[chat.startNodeId];
            if (start.type === "terminal")
              finishChat(flow, intent.instanceId, start.resultId, chat.startNodeId);
            break;
          }
          case "dispatchCase":
            if (!Object.hasOwn(state.cases, intent.caseId)) {
              state.cases[intent.caseId] = { status: "pending" };
              flow.dispatches.push({ nodeId, caseId: intent.caseId });
            }
            break;
          case "dispatchPool": {
            const candidates = flow.openPoolIds.includes(intent.poolId)
              ? definition.casePools[intent.poolId].members
                  .filter(
                    (member) =>
                      !Object.hasOwn(state.cases, member.caseId) &&
                      matchesMainFlowCondition(state, member.when),
                  )
                  .map((member) => member.caseId)
              : [];
            const caseId = intent.strategy.caseIds.find((id) => candidates.includes(id));
            if (caseId === undefined) {
              flow.needsDecision = { reason: "emptyPool", nodeId, candidateIds: candidates };
            } else {
              state.cases[caseId] = { status: "pending" };
              flow.dispatches.push({ nodeId, caseId });
            }
            break;
          }
        }
      }
    }
    if (flow.needsDecision !== null) return;
    const matches = node.transitions.filter((entry) => matchesMainFlowCondition(state, entry.when));
    if (matches.length === 0) return;
    if (matches.length > 1) {
      flow.needsDecision = {
        reason: "transitionConflict",
        nodeId,
        candidateIds: matches.map((entry) => entry.id),
      };
      return;
    }
    flow.currentNodeId = matches[0].targetNodeId;
  }
}

export function initializeMainFlow(state: GameState, content: Readonly<GameContentCatalog>): void {
  if (!content.mainFlow) return;
  state.mainFlow = {
    currentNodeId: content.mainFlow.initialNodeId,
    enteredNodeIds: [],
    openPoolIds: [],
    chats: {},
    chatResults: {},
    publishedNewsIds: [],
    readNewsIds: [],
    dispatches: [],
    needsDecision: null,
  };
  advance(state, content);
}

/** Called once per successful choice command, never once per emitted case event. */
export function applyMainFlowChoice(
  state: GameState,
  content: Readonly<GameContentCatalog>,
): GameState {
  if (!content.mainFlow) return state;
  const next = structuredClone(state);
  const flow = next.mainFlow!;
  for (const [instanceId, chat] of Object.entries(flow.chats)) {
    chat.inactivityChoices += 1;
    const inactivity = content.mainFlow.chats[chat.chatId].inactivity;
    if (inactivity && chat.inactivityChoices >= inactivity.choiceThreshold) {
      finishChat(flow, instanceId, inactivity.resultId, null);
    }
  }
  advance(next, content);
  return next;
}

export function executeMainFlowCommand(
  state: Readonly<GameState>,
  command: Extract<GameCommand, { type: "replyChat" | "readNews" | "dismissTutorial" }>,
  content: Readonly<GameContentCatalog>,
): TransitionResult {
  const failure = (
    code: Extract<TransitionResult, { ok: false }>["code"],
    message: string,
  ): TransitionResult => ({ ok: false, code, message });
  if (state.phase.type !== "playing")
    return failure("RUN_FINISHED", "The run no longer accepts main-flow commands.");
  if (command.type === "dismissTutorial") {
    if (
      command.storyId !== content.mainFlow?.tutorialStoryId ||
      !state.pendingStoryIds.includes(command.storyId)
    ) {
      return failure(
        "INVALID_TUTORIAL_DISMISSAL",
        "Only the configured pending tutorial can be dismissed.",
      );
    }
    return {
      ok: true,
      nextState: {
        ...state,
        pendingStoryIds: state.pendingStoryIds.filter((id) => id !== command.storyId),
        completedStoryIds: [...state.completedStoryIds, command.storyId],
        storyCheckpoint:
          state.storyCheckpoint?.storyId === command.storyId ? null : state.storyCheckpoint,
      },
      feedback: [],
    };
  }
  if (state.pendingStoryIds.length)
    return failure("STORY_BLOCKING", "Complete the current required interaction first.");
  if (command.type === "readNews") {
    if (!state.mainFlow?.publishedNewsIds.includes(command.newsId))
      return failure("NEWS_NOT_AVAILABLE", "This news has not been published.");
    if (state.mainFlow.readNewsIds.includes(command.newsId))
      return failure("NEWS_ALREADY_READ", "This news has already been read.");
    const next = structuredClone(state);
    next.mainFlow!.readNewsIds.push(command.newsId);
    const storyId = content.mainFlow!.news[command.newsId].actionStoryId;
    if (storyId) next.pendingStoryIds.push(storyId);
    return { ok: true, nextState: next, feedback: [] };
  }
  const chat = state.mainFlow?.chats[command.instanceId];
  if (!chat || chat.currentNodeId !== command.nodeId)
    return failure("STALE_CHAT_REPLY", "This chat reply is no longer current.");
  const node = content.mainFlow!.chats[chat.chatId].nodes[chat.currentNodeId];
  const reply =
    node.type === "message" ? node.replies.find((item) => item.id === command.replyId) : undefined;
  if (!reply) return failure("INVALID_CHAT_REPLY", "The current chat does not offer this reply.");
  const next = structuredClone(state);
  const active = next.mainFlow!.chats[command.instanceId];
  active.history.push({ nodeId: command.nodeId, replyId: command.replyId });
  active.currentNodeId = reply.targetNodeId;
  active.inactivityChoices = 0;
  const target = content.mainFlow!.chats[active.chatId].nodes[reply.targetNodeId];
  if (target.type === "terminal") {
    finishChat(next.mainFlow!, command.instanceId, target.resultId, reply.targetNodeId);
    advance(next, content);
  }
  return { ok: true, nextState: next, feedback: [] };
}
