import type { GameContentCatalog } from "../content/schema";
import type { GameState } from "./model";

/** Persisted main-flow facts are validated against their exact bound content version. */
export function mainFlowInvariantErrors(
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
): string[] {
  const definition = content.mainFlow;
  const flow = state.mainFlow;
  if (!definition) return flow ? ["Legacy content cannot retain main-flow state."] : [];
  if (!flow) return ["Schema-v6 runs require main-flow state."];
  const errors: string[] = [];
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (
    !unique(flow.enteredNodeIds) ||
    !flow.enteredNodeIds.includes(flow.currentNodeId) ||
    flow.enteredNodeIds.some((id) => !Object.hasOwn(definition.nodes, id))
  )
    errors.push("Entered nodes must be unique valid nodes including the current node.");
  if (
    flow.enteredNodeIds[0] !== definition.initialNodeId ||
    flow.enteredNodeIds.at(-1) !== flow.currentNodeId ||
    flow.enteredNodeIds.some(
      (id, index) =>
        index > 0 &&
        !definition.nodes[flow.enteredNodeIds[index - 1]]?.transitions.some(
          (entry) => entry.targetNodeId === id,
        ),
    )
  )
    errors.push(
      "Entered nodes must retain an authored path from the initial node to the current node.",
    );
  const declared = Object.fromEntries(
    Object.values(definition.nodes).flatMap((node) =>
      node.onEnter
        .filter((intent) => intent.type === "startChat")
        .map((intent) => [intent.instanceId, intent.chatId]),
    ),
  );
  const started = flow.enteredNodeIds.flatMap(
    (id) =>
      definition.nodes[id]?.onEnter
        .filter((intent) => intent.type === "startChat")
        .map((intent) => intent.instanceId) ?? [],
  );
  const actual = [...Object.keys(flow.chats), ...Object.keys(flow.chatResults)];
  if (
    !unique(actual) ||
    actual.length !== started.length ||
    started.some((id) => !actual.includes(id))
  )
    errors.push("Every started chat must have exactly one active state or final result.");
  for (const [id, chat] of Object.entries(flow.chats)) {
    const template = definition.chats[chat.chatId];
    if (!template || declared[id] !== chat.chatId) {
      errors.push("Active chat references an invalid instance or template.");
      continue;
    }
    let expected = template.startNodeId;
    for (const item of chat.history) {
      const node = template.nodes[expected];
      const reply =
        node?.type === "message"
          ? node.replies.find((entry) => entry.id === item.replyId)
          : undefined;
      if (item.nodeId !== expected || !reply) {
        errors.push("Chat history must follow its authored reply path.");
        break;
      }
      expected = reply.targetNodeId;
    }
    if (expected !== chat.currentNodeId || template.nodes[chat.currentNodeId]?.type !== "message")
      errors.push("An active chat must retain the current message node reached by its history.");
    if (template.inactivity && chat.inactivityChoices >= template.inactivity.choiceThreshold)
      errors.push("An active chat cannot remain at its inactivity threshold.");
  }
  for (const [id, result] of Object.entries(flow.chatResults)) {
    const template = definition.chats[result.chatId];
    if (!template || declared[id] !== result.chatId) {
      errors.push("Chat result references an invalid instance or template.");
      continue;
    }
    const terminal =
      result.terminalNodeId === null ? undefined : template.nodes[result.terminalNodeId];
    if (
      result.reason === "normal"
        ? terminal?.type !== "terminal" || terminal.resultId !== result.resultId
        : result.terminalNodeId !== null || template.inactivity?.resultId !== result.resultId
    )
      errors.push("Chat result must match its authored completion reason.");
  }
  if (
    !unique(flow.openPoolIds) ||
    flow.openPoolIds.some((id) => !Object.hasOwn(definition.casePools, id))
  )
    errors.push("Open pools must be unique authored pools.");
  const enteredIntents = flow.enteredNodeIds.flatMap((id) => definition.nodes[id]?.onEnter ?? []);
  const opened = new Set(
    enteredIntents.filter((intent) => intent.type === "openPool").map((intent) => intent.poolId),
  );
  const published = new Set(
    enteredIntents.filter((intent) => intent.type === "publishNews").map((intent) => intent.newsId),
  );
  if (opened.size !== flow.openPoolIds.length || flow.openPoolIds.some((id) => !opened.has(id)))
    errors.push("Open pools must match entered node intents.");
  if (
    published.size !== flow.publishedNewsIds.length ||
    flow.publishedNewsIds.some((id) => !published.has(id))
  )
    errors.push("Published news must match entered node intents.");
  if (
    !unique(flow.publishedNewsIds) ||
    flow.publishedNewsIds.some((id) => !Object.hasOwn(definition.news, id)) ||
    !unique(flow.readNewsIds) ||
    flow.readNewsIds.some((id) => !flow.publishedNewsIds.includes(id))
  )
    errors.push("Read news must be unique published news.");
  for (const id of flow.readNewsIds) {
    const storyId = definition.news[id]?.actionStoryId;
    if (
      storyId &&
      !state.pendingStoryIds.includes(storyId) &&
      !state.completedStoryIds.includes(storyId)
    )
      errors.push("Read news must retain its queued or completed action story.");
  }
  if (
    !unique(flow.dispatches.map((entry) => entry.caseId)) ||
    flow.dispatches.some(
      (entry) =>
        !flow.enteredNodeIds.includes(entry.nodeId) || !Object.hasOwn(state.cases, entry.caseId),
    )
  )
    errors.push("Dispatch facts must uniquely retain issued cases and entered nodes.");
  for (const entry of flow.dispatches) {
    const intent = definition.nodes[entry.nodeId]?.onEnter.find(
      (item) => item.type === "dispatchCase" || item.type === "dispatchPool",
    );
    if (
      !intent ||
      (intent.type === "dispatchCase"
        ? intent.caseId !== entry.caseId
        : !intent.strategy.caseIds.includes(entry.caseId) ||
          !definition.casePools[intent.poolId].members.some(
            (member) => member.caseId === entry.caseId,
          ))
    )
      errors.push("Dispatch facts must match their originating authored intent.");
  }
  if (flow.needsDecision && flow.needsDecision.nodeId !== flow.currentNodeId)
    errors.push("Pending main-flow decisions must belong to the current node.");
  return errors;
}
