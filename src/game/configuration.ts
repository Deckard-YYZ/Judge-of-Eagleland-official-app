import type { CaseEvent, GameContentCatalog, Condition } from "../content/schema";
import type { ConfigurationFact, DispatchFact, GameState } from "./model";
import { evaluateCondition, type ProgressionResult, type ProgressionIssue } from "./progression";

/** Stable identity comes from the finite event fields, independent of clock and localization. */
export function caseEventId(event: CaseEvent): string {
  switch (event.type) {
    case "caseStarted":
      return JSON.stringify([event.type, event.caseId]);
    case "choiceCompleted":
      return JSON.stringify([event.type, event.caseId, event.nodeId, event.choiceId]);
    case "caseResolved":
      return JSON.stringify([event.type, event.caseId, event.resolutionId]);
  }
}

export interface PoolMemberEligibility {
  readonly caseId: string;
  readonly eligible: boolean;
  readonly predicates: readonly Readonly<{
    predicate: Condition["all"][number];
    matches: boolean;
  }>[];
}

/** Qualification does not issue a case; explain each authored predicate without mutation. */
export function queryCasePool(
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
  poolId: string,
): ProgressionResult<readonly PoolMemberEligibility[]> {
  const pools = content.configuration?.casePools;
  const pool = pools && Object.hasOwn(pools, poolId) ? pools[poolId] : undefined;
  if (!pool)
    return {
      ok: false,
      issues: [
        {
          code: "CONFIGURATION_INVALID",
          path: ["configuration", "casePools", poolId],
          message: `Unknown pool ${poolId}.`,
        },
      ],
    };
  const members: PoolMemberEligibility[] = [];
  const issues: ProgressionIssue[] = [];
  for (const member of pool.members) {
    if (!Object.hasOwn(content.cases, member.caseId))
      issues.push({
        code: "CASE_REFERENCE_INVALID",
        path: ["configuration", "casePools", poolId, "members", member.caseId],
        message: `Unknown pool case ${member.caseId}.`,
      });
    const predicates: { predicate: Condition["all"][number]; matches: boolean }[] = [];
    for (const predicate of member.when.all) {
      const result = evaluateCondition(state, { all: [predicate] }, content);
      if (!result.ok) issues.push(...result.issues);
      else predicates.push({ predicate, matches: result.value });
    }
    members.push({
      caseId: member.caseId,
      eligible: predicates.every((entry) => entry.matches),
      predicates,
    });
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: members };
}

export interface ConfigurationPlan {
  readonly hookIds: readonly string[];
  readonly storyIds: readonly string[];
  readonly dispatch: DispatchFact;
}

/** Conflicts and an empty qualified pool remain explicit decisions, never implicit fallbacks. */
export function queryConfigurationEvent(
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
  event: CaseEvent,
): ProgressionResult<ConfigurationPlan> {
  const configuration = content.configuration;
  if (!configuration)
    return { ok: true, value: { hookIds: [], storyIds: [], dispatch: { status: "none" } } };
  const eventId = caseEventId(event);
  const committed = state.configurationFacts?.find((fact) => fact.eventId === eventId);
  if (committed) {
    // A query for an already committed event explains its actual selection, even if later
    // state changes alter pool eligibility. Restore never substitutes a new dispatch plan.
    return {
      ok: true,
      value: {
        hookIds: [...committed.hookIds],
        storyIds: configuration.actionInputHooks
          .filter((hook) => committed.hookIds.includes(hook.id))
          .map((hook) => hook.storyId),
        dispatch:
          committed.dispatch.status === "needsDecision"
            ? {
                ...committed.dispatch,
                ruleIds: [...committed.dispatch.ruleIds],
                candidateCaseIds: [...committed.dispatch.candidateCaseIds],
              }
            : { ...committed.dispatch },
      },
    };
  }
  const hooks = configuration.actionInputHooks.filter(
    (hook) => caseEventId(hook.event) === eventId,
  );
  const rules: typeof configuration.dispatchRules = [];
  const candidates = new Map<string, string[]>();
  const issues: ProgressionIssue[] = [];
  for (const rule of configuration.dispatchRules) {
    if (caseEventId(rule.event) !== eventId) continue;
    const condition = evaluateCondition(state, rule.when, content);
    if (!condition.ok) {
      issues.push(...condition.issues);
      continue;
    }
    if (!condition.value) continue;
    const pool = queryCasePool(state, content, rule.poolId);
    if (!pool.ok) {
      issues.push(...pool.issues);
      continue;
    }
    rules.push(rule);
    candidates.set(
      rule.id,
      pool.value
        .filter((member) => member.eligible && !Object.hasOwn(state.cases, member.caseId))
        .map((member) => member.caseId),
    );
  }
  if (issues.length) return { ok: false, issues };
  let dispatch: DispatchFact = { status: "none" };
  if (rules.length > 1) {
    dispatch = {
      status: "needsDecision",
      reason: "ruleConflict",
      ruleIds: rules.map((rule) => rule.id),
      candidateCaseIds: [...new Set([...candidates.values()].flat())],
    };
  } else if (rules.length === 1) {
    const rule = rules[0];
    // This ordering is authored explicitly and exhaustively; array/record order is not a policy.
    const caseId = rule.strategy.caseIds.find((id) => candidates.get(rule.id)?.includes(id));
    dispatch = caseId
      ? { status: "dispatched", ruleId: rule.id, caseId }
      : { status: "needsDecision", reason: "emptyPool", ruleIds: [rule.id], candidateCaseIds: [] };
  }
  return {
    ok: true,
    value: {
      hookIds: hooks.map((hook) => hook.id),
      storyIds: hooks.map((hook) => hook.storyId),
      dispatch,
    },
  };
}

/** Composes facts into the candidate transaction. Session is the only persistence publisher. */
export function applyConfigurationEvent(
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
  event: CaseEvent,
): ProgressionResult<GameState> {
  if (!content.configuration) return { ok: true, value: state as GameState };
  const eventId = caseEventId(event);
  const facts = state.configurationFacts ?? [];
  if (facts.some((fact) => fact.eventId === eventId))
    return { ok: true, value: state as GameState };
  const plan = queryConfigurationEvent(state, content, event);
  if (!plan.ok) return plan;
  const seenStories = new Set([...state.pendingStoryIds, ...state.completedStoryIds]);
  const fact: ConfigurationFact = {
    eventId,
    event,
    hookIds: [...plan.value.hookIds],
    dispatch: plan.value.dispatch,
  };
  return {
    ok: true,
    value: {
      ...state,
      configurationFacts: [...facts, fact],
      pendingStoryIds: [
        ...state.pendingStoryIds,
        ...plan.value.storyIds.filter((id) => !seenStories.has(id)),
      ],
      cases:
        plan.value.dispatch.status === "dispatched"
          ? { ...state.cases, [plan.value.dispatch.caseId]: { status: "pending" } }
          : state.cases,
    },
  };
}
