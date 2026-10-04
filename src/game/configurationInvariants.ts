import type { CaseEvent, GameContentCatalog } from "../content/schema";
import type { GameState } from "./model";
import { caseEventId } from "./configuration";

/** History proves event identity; saved dispatch selections are never recomputed on restore. */
export function configurationInvariantErrors(
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
): string[] {
  const configuration = content.configuration;
  const facts = state.configurationFacts;
  if (!configuration)
    return facts?.length ? ["Legacy content cannot retain configuration facts."] : [];
  if (!facts) return ["Schema-v5 runs require a configuration ledger."];
  const expected = new Set<string>();
  for (const [caseId, progress] of Object.entries(state.cases)) {
    if (progress.status === "pending") continue;
    expected.add(caseEventId({ type: "caseStarted", caseId }));
    for (const record of progress.history)
      expected.add(caseEventId({ type: "choiceCompleted", caseId, ...record }));
    if (progress.status === "resolved")
      expected.add(
        caseEventId({ type: "caseResolved", caseId, resolutionId: progress.resolutionId }),
      );
  }
  const errors: string[] = [];
  const seen = new Set<string>();
  const issued = new Set<string>(state.mainFlow?.dispatches.map((entry) => entry.caseId));
  const matches = (left: CaseEvent, right: CaseEvent) => caseEventId(left) === caseEventId(right);
  for (const fact of facts) {
    if (
      fact.eventId !== caseEventId(fact.event) ||
      !expected.has(fact.eventId) ||
      seen.has(fact.eventId)
    )
      errors.push("Ledger events must uniquely match committed case history.");
    seen.add(fact.eventId);
    const hooks = configuration.actionInputHooks.filter((hook) => matches(hook.event, fact.event));
    if (
      hooks.length !== fact.hookIds.length ||
      new Set(fact.hookIds).size !== fact.hookIds.length ||
      hooks.some((hook) => !fact.hookIds.includes(hook.id))
    )
      errors.push("Recorded hooks must exactly match their business event.");
    if (
      hooks.some(
        (hook) =>
          !state.pendingStoryIds.includes(hook.storyId) &&
          !state.completedStoryIds.includes(hook.storyId),
      )
    )
      errors.push("A fired hook must retain its queued or completed interaction.");
    const dispatch = fact.dispatch;
    if (dispatch.status === "none") continue;
    const ruleIds = dispatch.status === "dispatched" ? [dispatch.ruleId] : dispatch.ruleIds;
    const rules = ruleIds.map((id) => configuration.dispatchRules.find((rule) => rule.id === id));
    if (
      new Set(ruleIds).size !== ruleIds.length ||
      rules.some((rule) => !rule || !matches(rule.event, fact.event))
    )
      errors.push("Saved dispatch rules must exist and match the recorded event.");
    const poolMembers = new Set(
      rules.flatMap((rule) =>
        rule && Object.hasOwn(configuration.casePools, rule.poolId)
          ? configuration.casePools[rule.poolId].members.map((member) => member.caseId)
          : [],
      ),
    );
    if (dispatch.status === "dispatched") {
      if (
        !Object.hasOwn(state.cases, dispatch.caseId) ||
        !poolMembers.has(dispatch.caseId) ||
        issued.has(dispatch.caseId) ||
        content.initial.caseIds.includes(dispatch.caseId)
      )
        errors.push("Selected dispatch must issue one existing pool member exactly once.");
      issued.add(dispatch.caseId);
    } else {
      if (
        dispatch.candidateCaseIds.some((id) => !poolMembers.has(id)) ||
        new Set(dispatch.candidateCaseIds).size !== dispatch.candidateCaseIds.length ||
        (dispatch.reason === "ruleConflict" && ruleIds.length < 2) ||
        (dispatch.reason === "emptyPool" &&
          (ruleIds.length !== 1 || dispatch.candidateCaseIds.length !== 0))
      )
        errors.push("Pending dispatch decision has inconsistent reason or candidates.");
    }
  }
  if (seen.size !== expected.size || [...expected].some((id) => !seen.has(id)))
    errors.push("Every committed case event must retain one ledger fact.");
  // Legacy unlock rules retain their authored semantics; configured pools are issued only by plans.
  const legacyUnlockCases = new Set(content.unlockRules.flatMap((rule) => rule.caseIds));
  if (
    Object.keys(state.cases).some(
      (id) =>
        !content.initial.caseIds.includes(id) && !legacyUnlockCases.has(id) && !issued.has(id),
    )
  )
    errors.push("Noninitial cases must retain a dispatch fact.");
  return errors;
}
