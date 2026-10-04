import type {
  ChatTarget,
  FlowCondition,
  FlowConsequence,
  FlowFacts,
  FlowPredicate,
  GameContentCatalog,
  AssetDefinition,
  CaseEvent,
} from "../content/schema";
import type { GameState } from "./model";
import { evaluateCondition, type ProgressionResult, type ProgressionIssue } from "./progression";
import { caseEventId } from "./configuration";

// Internal computations require the validated boundary in application/configurationQueries.
// All predicates read the supplied snapshot/facts before applying any returned target or intent.

export interface ConditionExplanation {
  readonly operator: "all" | "any";
  readonly matches: boolean;
  readonly predicates: readonly Readonly<{ predicate: FlowPredicate; matches: boolean }>[];
}
const invalid = <T>(
  message: string,
  path: readonly (string | number)[] = [],
): ProgressionResult<T> => ({
  ok: false,
  issues: [{ code: "CONFIGURATION_INVALID", path, message }],
});

/** Facts are an explicit read-only input. No inferred stage, chat order, or persistence. */
function prepare(
  content: Readonly<GameContentCatalog>,
  facts: Readonly<FlowFacts>,
): ProgressionResult<FlowFacts> {
  const flow = content.configuration?.flow;
  if (!flow) return invalid("This content has no flow configuration.", ["configuration", "flow"]);
  const issues: ProgressionIssue[] = [];
  if (!Object.hasOwn(flow.stages, facts.currentStageId))
    issues.push({
      code: "CONFIGURATION_INVALID",
      path: ["facts", "currentStageId"],
      message: "Unknown current stage fact.",
    });
  for (const [chatId, nodeId] of Object.entries(facts.lastChatNodeIds)) {
    if (!Object.hasOwn(flow.chats, chatId) || !Object.hasOwn(flow.chats[chatId].nodes, nodeId))
      issues.push({
        code: "CONFIGURATION_INVALID",
        path: ["facts", "lastChatNodeIds", chatId],
        message: "Last chat node fact must belong to its named chat.",
      });
  }
  for (const [chatId, nodeId] of Object.entries(facts.activeChatNodeIds ?? {})) {
    if (!Object.hasOwn(flow.chats, chatId) || !Object.hasOwn(flow.chats[chatId].nodes, nodeId))
      issues.push({
        code: "CONFIGURATION_INVALID",
        path: ["facts", "activeChatNodeIds", chatId],
        message: "Active chat node fact must belong to its named chat.",
      });
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: facts };
}

function explain(
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
  facts: Readonly<FlowFacts>,
  condition: FlowCondition,
): ProgressionResult<ConditionExplanation> {
  const operator = "all" in condition ? "all" : "any";
  const predicates = "all" in condition ? condition.all : condition.any;
  const entries: { predicate: FlowPredicate; matches: boolean }[] = [];
  const issues: ProgressionIssue[] = [];
  for (const predicate of predicates) {
    if (predicate.type === "currentStage")
      entries.push({ predicate, matches: facts.currentStageId === predicate.stageId });
    else if (predicate.type === "chatLastNode")
      entries.push({
        predicate,
        matches:
          Object.hasOwn(facts.lastChatNodeIds, predicate.chatId) &&
          facts.lastChatNodeIds[predicate.chatId] === predicate.nodeId,
      });
    else {
      const result = evaluateCondition(state, { all: [predicate] }, content);
      if (!result.ok) issues.push(...result.issues);
      else entries.push({ predicate, matches: result.value });
    }
  }
  return issues.length
    ? { ok: false, issues }
    : {
        ok: true,
        value: {
          operator,
          matches:
            operator === "all"
              ? entries.every((entry) => entry.matches)
              : entries.some((entry) => entry.matches),
          predicates: entries,
        },
      };
}

export interface StageTransitionCandidate {
  readonly id: string;
  readonly targetStageId: string;
  readonly condition: ConditionExplanation;
  readonly targetEligibility: ConditionExplanation;
  readonly eligible: boolean;
}
export interface StageTransitionQuery {
  readonly currentStageId: string;
  readonly candidates: readonly StageTransitionCandidate[];
  readonly decision:
    | Readonly<{ status: "terminal" }>
    | Readonly<{ status: "matched"; transitionId: string; targetStageId: string }>
    | Readonly<{
        status: "needsDecision";
        reason: "noMatch" | "conflict";
        transitionIds: readonly string[];
      }>;
}

export function computeStageTransitions(
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
  input: Readonly<FlowFacts>,
): ProgressionResult<StageTransitionQuery> {
  const facts = prepare(content, input);
  if (!facts.ok) return facts;
  const flow = content.configuration!.flow!;
  const stage = flow.stages[facts.value.currentStageId];
  const candidates: StageTransitionCandidate[] = [];
  for (const transition of stage.transitions) {
    const condition = explain(state, content, facts.value, transition.when);
    if (!condition.ok) return condition;
    const target = explain(state, content, facts.value, flow.stages[transition.targetStageId].when);
    if (!target.ok) return target;
    candidates.push({
      id: transition.id,
      targetStageId: transition.targetStageId,
      condition: condition.value,
      targetEligibility: target.value,
      eligible: condition.value.matches && target.value.matches,
    });
  }
  const eligible = candidates.filter((candidate) => candidate.eligible);
  let decision: StageTransitionQuery["decision"];
  if (!candidates.length) {
    // A stage with no configured successor is distinct from the game's ending phase.
    decision = { status: "terminal" };
  } else if (eligible.length === 1) {
    decision = {
      status: "matched",
      transitionId: eligible[0].id,
      targetStageId: eligible[0].targetStageId,
    };
  } else {
    decision = {
      status: "needsDecision",
      reason: eligible.length ? "conflict" : "noMatch",
      transitionIds: eligible.map((candidate) => candidate.id),
    };
  }
  return { ok: true, value: { currentStageId: facts.value.currentStageId, candidates, decision } };
}

export interface ChatAvailability {
  readonly chatId: string;
  readonly characterId: string;
  readonly startNodeId: string;
  readonly condition: ConditionExplanation;
}
export function computeChatAvailability(
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
  input: Readonly<FlowFacts>,
): ProgressionResult<readonly ChatAvailability[]> {
  const facts = prepare(content, input);
  if (!facts.ok) return facts;
  const candidates: ChatAvailability[] = [];
  for (const [chatId, chat] of Object.entries(content.configuration!.flow!.chats)) {
    const condition = explain(state, content, facts.value, chat.when);
    if (!condition.ok) return condition;
    candidates.push({
      chatId,
      characterId: chat.characterId,
      startNodeId: chat.startNodeId,
      condition: condition.value,
    });
  }
  return { ok: true, value: candidates };
}

export interface ChatReplyCandidate {
  readonly id: string;
  readonly target: ChatTarget;
  readonly condition: ConditionExplanation;
  readonly eventEligibility?: ConditionExplanation;
  readonly eventTargets?: ConsequenceEligibility;
  readonly eligible: boolean;
}
export interface ConsequenceEligibility {
  readonly eligible: boolean;
  readonly stageTargets: readonly Readonly<{ stageId: string; condition: ConditionExplanation }>[];
}
function explainConsequences(
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
  facts: Readonly<FlowFacts>,
  consequences: readonly FlowConsequence[],
): ProgressionResult<ConsequenceEligibility> {
  const stageTargets: { stageId: string; condition: ConditionExplanation }[] = [];
  for (const consequence of consequences) {
    if (consequence.type !== "enterStage") continue;
    const condition = explain(
      state,
      content,
      facts,
      content.configuration!.flow!.stages[consequence.stageId].when,
    );
    if (!condition.ok) return condition;
    stageTargets.push({ stageId: consequence.stageId, condition: condition.value });
  }
  return {
    ok: true,
    value: { eligible: stageTargets.every((target) => target.condition.matches), stageTargets },
  };
}
export type ChatNodeQuery =
  | Readonly<{
      status: "terminal" | "needsDecision";
      reason?: "targetStageUnavailable";
      consequences: readonly FlowConsequence[];
      eligibility: ConsequenceEligibility;
    }>
  | Readonly<{
      status: "replies" | "needsDecision";
      reason?: "chatNotActive" | "noAvailableReplies";
      availability: ConditionExplanation;
      replies: readonly ChatReplyCandidate[];
    }>;

export function computeChatNode(
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
  input: Readonly<FlowFacts>,
  chatId: string,
  nodeId: string,
): ProgressionResult<ChatNodeQuery> {
  const facts = prepare(content, input);
  if (!facts.ok) return facts;
  const flow = content.configuration!.flow!;
  if (!Object.hasOwn(flow.chats, chatId) || !Object.hasOwn(flow.chats[chatId].nodes, nodeId))
    return invalid("Unknown chat or local node.", ["chats", chatId, "nodes", nodeId]);
  const chat = flow.chats[chatId];
  const availability = explain(state, content, facts.value, chat.when);
  if (!availability.ok) return availability;
  // Appearance eligibility can change after activation. Only the explicit active-node fact
  // decides whether this held conversation may continue; no auto-close/reopen policy exists.
  if (
    !facts.value.activeChatNodeIds ||
    !Object.hasOwn(facts.value.activeChatNodeIds, chatId) ||
    facts.value.activeChatNodeIds[chatId] !== nodeId
  )
    return {
      ok: true,
      value: {
        status: "needsDecision",
        reason: "chatNotActive",
        availability: availability.value,
        replies: [],
      },
    };
  const node = chat.nodes[nodeId];
  if (node.type === "terminal") {
    const eligibility = explainConsequences(state, content, facts.value, node.consequences);
    if (!eligibility.ok) return eligibility;
    return {
      ok: true,
      value: {
        status: eligibility.value.eligible ? "terminal" : "needsDecision",
        ...(eligibility.value.eligible ? {} : { reason: "targetStageUnavailable" as const }),
        consequences: eligibility.value.eligible ? node.consequences : [],
        eligibility: eligibility.value,
      },
    };
  }
  const replies: ChatReplyCandidate[] = [];
  for (const reply of node.replies) {
    const condition = explain(state, content, facts.value, reply.when);
    if (!condition.ok) return condition;
    const event =
      reply.target.type === "event"
        ? explain(state, content, facts.value, flow.events[reply.target.eventId].when)
        : undefined;
    if (event && !event.ok) return event;
    const eventTargets =
      reply.target.type === "event"
        ? explainConsequences(
            state,
            content,
            facts.value,
            flow.events[reply.target.eventId].consequences,
          )
        : undefined;
    if (eventTargets && !eventTargets.ok) return eventTargets;
    replies.push({
      id: reply.id,
      target: reply.target,
      condition: condition.value,
      ...(event ? { eventEligibility: event.value } : {}),
      ...(eventTargets ? { eventTargets: eventTargets.value } : {}),
      eligible:
        condition.value.matches &&
        (event?.value.matches ?? true) &&
        (eventTargets?.value.eligible ?? true),
    });
  }
  return {
    ok: true,
    value: {
      status: replies.some((reply) => reply.eligible) ? "replies" : "needsDecision",
      ...(replies.some((reply) => reply.eligible) ? {} : { reason: "noAvailableReplies" as const }),
      availability: availability.value,
      replies,
    },
  };
}

export function computeFlowEvent(
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
  input: Readonly<FlowFacts>,
  eventId: string,
): ProgressionResult<
  Readonly<{
    status: "matched" | "needsDecision";
    reason?: "conditionUnmet" | "targetStageUnavailable";
    condition: ConditionExplanation;
    eligibility: ConsequenceEligibility;
    consequences: readonly FlowConsequence[];
  }>
> {
  const facts = prepare(content, input);
  if (!facts.ok) return facts;
  const events = content.configuration!.flow!.events;
  if (!Object.hasOwn(events, eventId))
    return invalid("Unknown external chat event.", ["events", eventId]);
  const event = events[eventId];
  const condition = explain(state, content, facts.value, event.when);
  if (!condition.ok) return condition;
  const eligibility = explainConsequences(state, content, facts.value, event.consequences);
  if (!eligibility.ok) return eligibility;
  const matches = condition.value.matches && eligibility.value.eligible;
  return {
    ok: true,
    value: {
      status: matches ? "matched" : "needsDecision",
      ...(matches
        ? {}
        : {
            reason: condition.value.matches
              ? ("targetStageUnavailable" as const)
              : ("conditionUnmet" as const),
          }),
      condition: condition.value,
      eligibility: eligibility.value,
      consequences: matches ? event.consequences : [],
    },
  };
}

/** Character author rows are compiled into the existing case contract; asset refs stay explicit. */
export function computeCaseCharacters(
  content: Readonly<GameContentCatalog>,
  caseId: string,
): ProgressionResult<
  readonly Readonly<{
    id: string;
    portraitAssetId?: string;
    portrait?: AssetDefinition & { assetId: string };
  }>[]
> {
  if (!Object.hasOwn(content.cases, caseId))
    return invalid("Unknown case character lookup.", ["cases", caseId]);
  const issues: ProgressionIssue[] = [];
  const characters = content.cases[caseId].characters.map((character) => {
    const assetId = character.portraitAssetId;
    if (
      assetId !== undefined &&
      (!Object.hasOwn(content.assets, assetId) || content.assets[assetId].kind !== "image")
    )
      issues.push({
        code: "CONFIGURATION_INVALID",
        path: ["cases", caseId, "characters", character.id, "portraitAssetId"],
        message: "Unknown or nonimage portrait asset.",
      });
    return {
      ...character,
      ...(assetId !== undefined && Object.hasOwn(content.assets, assetId)
        ? { portrait: { assetId, ...content.assets[assetId] } }
        : {}),
    };
  });
  return issues.length ? { ok: false as const, issues } : { ok: true as const, value: characters };
}

export interface ChatExternalCandidate {
  readonly id: string;
  readonly targetNodeId: string;
  readonly eventMatches: boolean;
  readonly condition: ConditionExplanation;
  readonly consequenceEligibility: ConsequenceEligibility;
  readonly eligible: boolean;
}
export interface ChatExternalQuery {
  readonly availability: ConditionExplanation;
  readonly candidates: readonly ChatExternalCandidate[];
  readonly decision:
    | Readonly<{
        status: "matched";
        branchId: string;
        targetNodeId: string;
        consequences: readonly FlowConsequence[];
      }>
    | Readonly<{
        status: "needsDecision";
        reason: "chatNotActive" | "noMatch" | "conflict";
        branchIds: readonly string[];
      }>;
}

/** A committed case event can move a held chat node. Reply/event scheduling is not a policy here. */
export function computeChatExternalEvent(
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
  input: Readonly<FlowFacts>,
  chatId: string,
  nodeId: string,
  event: CaseEvent,
): ProgressionResult<ChatExternalQuery> {
  const facts = prepare(content, input);
  if (!facts.ok) return facts;
  const flow = content.configuration!.flow!;
  if (!Object.hasOwn(flow.chats, chatId) || !Object.hasOwn(flow.chats[chatId].nodes, nodeId))
    return invalid("Unknown chat or local node.", ["chats", chatId, "nodes", nodeId]);
  const chat = flow.chats[chatId];
  const node = chat.nodes[nodeId];
  const availability = explain(state, content, facts.value, chat.when);
  if (!availability.ok) return availability;
  const branches = node.type === "message" ? (node.externalBranches ?? []) : [];
  const active =
    facts.value.activeChatNodeIds !== undefined &&
    Object.hasOwn(facts.value.activeChatNodeIds, chatId) &&
    facts.value.activeChatNodeIds[chatId] === nodeId;
  const candidates: ChatExternalCandidate[] = [];
  for (const branch of branches) {
    const condition = explain(state, content, facts.value, branch.when);
    if (!condition.ok) return condition;
    const consequenceEligibility = explainConsequences(
      state,
      content,
      facts.value,
      branch.consequences,
    );
    if (!consequenceEligibility.ok) return consequenceEligibility;
    const eventMatches = caseEventId(branch.event) === caseEventId(event);
    candidates.push({
      id: branch.id,
      targetNodeId: branch.targetNodeId,
      eventMatches,
      condition: condition.value,
      consequenceEligibility: consequenceEligibility.value,
      eligible:
        active && eventMatches && condition.value.matches && consequenceEligibility.value.eligible,
    });
  }
  const eligible = candidates.filter((candidate) => candidate.eligible);
  let decision: ChatExternalQuery["decision"];
  if (eligible.length === 1) {
    const selected = eligible[0];
    decision = {
      status: "matched",
      branchId: selected.id,
      targetNodeId: selected.targetNodeId,
      consequences: branches.find((branch) => branch.id === selected.id)!.consequences,
    };
  } else {
    decision = {
      status: "needsDecision",
      reason: !active ? "chatNotActive" : eligible.length ? "conflict" : "noMatch",
      branchIds: eligible.map((candidate) => candidate.id),
    };
  }
  return { ok: true, value: { availability: availability.value, candidates, decision } };
}
