import type { CaseEvent, Condition, GameContentCatalog } from "./schema";
import type { ContentValidationIssueCode, ContentValidationPath } from "./validate";

type Collector = (
  code: ContentValidationIssueCode,
  id: string,
  path: ContentValidationPath,
  message: string,
) => void;
const own = <T>(record: Readonly<Record<string, T>>, id: string): T | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

/** Schema 5 keeps interaction penalties outside every rule that can change the run's outcome. */
export function validateConfiguration(
  content: Readonly<GameContentCatalog>,
  add: Collector,
  checkCondition: (condition: Condition, path: ContentValidationPath, id: string) => void,
): void {
  const configuration = content.configuration;
  if (!configuration) return;
  const fail = (id: string, path: ContentValidationPath, message: string) =>
    add("CONFIGURATION_INVALID", id, path, message);
  const unique = (ids: readonly string[], path: ContentValidationPath, id: string) => {
    if (new Set(ids).size !== ids.length) fail(id, path, "IDs must be unique.");
  };
  const attributes = new Set(configuration.interactionOnly.attributeIds);
  const flags = new Set(configuration.interactionOnly.flagIds);
  unique(
    configuration.interactionOnly.attributeIds,
    ["configuration", "interactionOnly", "attributeIds"],
    "interactionOnly",
  );
  unique(
    configuration.interactionOnly.flagIds,
    ["configuration", "interactionOnly", "flagIds"],
    "interactionOnly",
  );
  for (const id of attributes)
    if (!own(content.attributes, id))
      fail(id, ["configuration", "interactionOnly", "attributeIds"], `Unknown attribute ${id}.`);
  for (const id of flags)
    if (!Object.hasOwn(content.initial.flags, id))
      fail(id, ["configuration", "interactionOnly", "flagIds"], `Unknown flag ${id}.`);
  const isolatedCondition = (condition: Condition, path: ContentValidationPath, id: string) => {
    checkCondition(condition, path, id);
    condition.all.forEach((predicate, index) => {
      if (
        ("attributeId" in predicate && attributes.has(predicate.attributeId)) ||
        ("flagId" in predicate && flags.has(predicate.flagId))
      ) {
        fail(
          id,
          [...path, "all", index, "attributeId" in predicate ? "attributeId" : "flagId"],
          "Business conditions cannot read interactionOnly state.",
        );
      }
    });
  };
  const eventReference = (event: CaseEvent, path: ContentValidationPath, id: string) => {
    const definition = own(content.cases, event.caseId);
    if (!definition) {
      fail(id, [...path, "caseId"], `Unknown case ${event.caseId}.`);
      return;
    }
    if (event.type === "caseResolved" && !own(definition.resolutions, event.resolutionId))
      fail(id, [...path, "resolutionId"], `Unknown resolution ${event.resolutionId}.`);
    if (
      event.type === "choiceCompleted" &&
      !own(definition.nodes, event.nodeId)?.choices.some((choice) => choice.id === event.choiceId)
    )
      fail(id, path, "Event must name an existing node and its choice.");
  };
  const instructionNodes = new Set<string>();
  for (const [id, instruction] of Object.entries(configuration.instructions)) {
    const path = ["configuration", "instructions", id];
    eventReference({ type: "choiceCompleted", ...instruction }, path, id);
    const nodeKey = JSON.stringify([instruction.caseId, instruction.nodeId]);
    if (instructionNodes.has(nodeKey))
      fail(id, path, "A decision round may have only one instruction.");
    instructionNodes.add(nodeKey);
  }
  unique(
    configuration.actionInputHooks.map((hook) => hook.id),
    ["configuration", "actionInputHooks"],
    "hooks",
  );
  unique(
    configuration.actionInputHooks.map((hook) => hook.storyId),
    ["configuration", "actionInputHooks"],
    "hooks",
  );
  const hookEvents = new Set<string>();
  configuration.actionInputHooks.forEach((hook, index) => {
    const path = ["configuration", "actionInputHooks", index];
    eventReference(hook.event, [...path, "event"], hook.id);
    const eventKey = JSON.stringify(hook.event);
    if (hookEvents.has(eventKey))
      fail(
        hook.id,
        [...path, "event"],
        "Multiple ActionInput hooks on one event require an explicit sequencing policy; currently unsupported.",
      );
    hookEvents.add(eventKey);
    const story = own(content.stories, hook.storyId);
    // This module is deliberately one information screen followed by one mandatory action.
    if (
      !story ||
      story.skippable ||
      story.steps.length !== 2 ||
      story.steps[0].type !== "text" ||
      story.steps[1].type !== "actionInput"
    )
      fail(
        hook.id,
        [...path, "storyId"],
        "ActionInput hooks require exactly information → actionInput, unskippable.",
      );
    if (
      content.initial.storyIds.includes(hook.storyId) ||
      content.storyRules.some((rule) => rule.storyId === hook.storyId) ||
      Object.values(content.endings).some((ending) => ending.storyId === hook.storyId)
    )
      fail(
        hook.id,
        [...path, "storyId"],
        "Hook story cannot also be initial, condition-queued, or an ending.",
      );
  });
  for (const [poolId, pool] of Object.entries(configuration.casePools)) {
    unique(
      pool.members.map((member) => member.caseId),
      ["configuration", "casePools", poolId, "members"],
      poolId,
    );
    pool.members.forEach((member, index) => {
      const path = ["configuration", "casePools", poolId, "members", index];
      if (!own(content.cases, member.caseId))
        fail(poolId, [...path, "caseId"], `Unknown case ${member.caseId}.`);
      isolatedCondition(member.when, [...path, "when"], poolId);
    });
  }
  unique(
    configuration.dispatchRules.map((rule) => rule.id),
    ["configuration", "dispatchRules"],
    "dispatchRules",
  );
  configuration.dispatchRules.forEach((rule, index) => {
    const path = ["configuration", "dispatchRules", index];
    eventReference(rule.event, [...path, "event"], rule.id);
    isolatedCondition(rule.when, [...path, "when"], rule.id);
    const pool = own(configuration.casePools, rule.poolId);
    if (!pool) fail(rule.id, [...path, "poolId"], `Unknown pool ${rule.poolId}.`);
    unique(rule.strategy.caseIds, [...path, "strategy", "caseIds"], rule.id);
    const members = pool?.members.map((member) => member.caseId) ?? [];
    if (
      members.length !== rule.strategy.caseIds.length ||
      rule.strategy.caseIds.some((id) => !members.includes(id))
    )
      fail(
        rule.id,
        [...path, "strategy", "caseIds"],
        "Ordered strategy must explicitly list every pool member exactly once.",
      );
  });
  content.unlockRules.forEach((rule, index) =>
    isolatedCondition(rule.when, ["unlockRules", index, "when"], rule.id),
  );
  content.storyRules.forEach((rule, index) =>
    isolatedCondition(rule.when, ["storyRules", index, "when"], rule.id),
  );
  for (const [id, ending] of Object.entries(content.endings))
    isolatedCondition(ending.when, ["endings", id, "when"], id);
  for (const [caseId, definition] of Object.entries(content.cases)) {
    for (const [resolutionId, resolution] of Object.entries(definition.resolutions)) {
      for (const id of Object.keys(resolution.effects.attributeDeltas))
        if (attributes.has(id))
          fail(
            caseId,
            ["cases", caseId, "resolutions", resolutionId, "effects", "attributeDeltas", id],
            "Verdicts cannot write interactionOnly attributes.",
          );
      for (const id of Object.keys(resolution.effects.setFlags))
        if (flags.has(id))
          fail(
            caseId,
            ["cases", caseId, "resolutions", resolutionId, "effects", "setFlags", id],
            "Verdicts cannot write interactionOnly flags.",
          );
    }
  }
  for (const [storyId, story] of Object.entries(content.stories)) {
    story.steps.forEach((step, index) => {
      if (step.type !== "actionInput") return;
      for (const id of Object.keys(step.wrongEffects?.attributeDeltas ?? {}))
        if (!attributes.has(id))
          fail(
            storyId,
            ["stories", storyId, "steps", index, "wrongEffects", "attributeDeltas", id],
            "ActionInput can only write interactionOnly attributes.",
          );
      for (const id of Object.keys(step.wrongEffects?.setFlags ?? {}))
        if (!flags.has(id))
          fail(
            storyId,
            ["stories", storyId, "steps", index, "wrongEffects", "setFlags", id],
            "ActionInput can only write interactionOnly flags.",
          );
    });
  }
}
