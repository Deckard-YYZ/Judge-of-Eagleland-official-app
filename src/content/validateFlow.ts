import type {
  FlowCondition,
  FlowConsequence,
  GameContentCatalog,
  LocalizedContentCatalog,
} from "./schema";
import type { ContentValidationIssueCode, ContentValidationPath } from "./validate";

type Collector = (
  code: ContentValidationIssueCode,
  id: string,
  path: ContentValidationPath,
  message: string,
) => void;
const own = <T>(record: Readonly<Record<string, T>>, id: string): T | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

/** Finite references and isolation rules are validated before any flow query can run. */
export function validateFlow(content: Readonly<GameContentCatalog>, add: Collector): void {
  const fail = (id: string, path: ContentValidationPath, message: string) =>
    add("CONFIGURATION_INVALID", id, path, message);
  const characters = new Set<string>();
  for (const [caseId, definition] of Object.entries(content.cases)) {
    const seen = new Set<string>();
    definition.characters.forEach((character, index) => {
      const path = ["cases", caseId, "characters", index];
      if (seen.has(character.id)) fail(caseId, path, "Case character IDs must be unique.");
      seen.add(character.id);
      characters.add(character.id);
      if (character.portraitAssetId !== undefined) {
        const asset = own(content.assets, character.portraitAssetId);
        if (!asset || asset.kind !== "image")
          fail(
            character.id,
            [...path, "portraitAssetId"],
            "Portrait must reference an image asset.",
          );
      }
    });
  }
  const configuration = content.configuration;
  const flow = configuration?.flow;
  if (!flow) return;
  const base = ["configuration", "flow"];
  const isolatedAttributes = new Set(configuration.interactionOnly.attributeIds);
  const isolatedFlags = new Set(configuration.interactionOnly.flagIds);
  const condition = (value: FlowCondition, path: ContentValidationPath, id: string) => {
    const operator = "all" in value ? "all" : "any";
    const predicates = "all" in value ? value.all : value.any;
    predicates.forEach((predicate, index) => {
      const target = [...path, operator, index];
      switch (predicate.type) {
        case "currentStage":
          if (!own(flow.stages, predicate.stageId))
            fail(id, [...target, "stageId"], "Unknown stage predicate reference.");
          break;
        case "chatLastNode":
          if (
            !own(flow.chats, predicate.chatId) ||
            !own(flow.chats[predicate.chatId].nodes, predicate.nodeId)
          )
            fail(id, target, "Unknown chat or its local node predicate reference.");
          break;
        case "caseResolved": {
          const definition = own(content.cases, predicate.caseId);
          if (!definition) fail(id, [...target, "caseId"], "Unknown case predicate reference.");
          else if (
            predicate.resolutionId !== undefined &&
            !own(definition.resolutions, predicate.resolutionId)
          )
            fail(id, [...target, "resolutionId"], "Unknown case resolution predicate reference.");
          break;
        }
        case "attributeAtLeast":
        case "attributeAtMost":
          if (!own(content.attributes, predicate.attributeId))
            fail(id, [...target, "attributeId"], "Unknown attribute predicate reference.");
          if (isolatedAttributes.has(predicate.attributeId))
            fail(
              id,
              [...target, "attributeId"],
              "Flow conditions cannot read interactionOnly attributes.",
            );
          break;
        case "flagEquals":
          if (!Object.hasOwn(content.initial.flags, predicate.flagId))
            fail(id, [...target, "flagId"], "Unknown flag predicate reference.");
          if (isolatedFlags.has(predicate.flagId))
            fail(id, [...target, "flagId"], "Flow conditions cannot read interactionOnly flags.");
          break;
        case "resolvedCountAtLeast":
          break;
      }
    });
  };
  const consequences = (
    values: readonly FlowConsequence[],
    path: ContentValidationPath,
    id: string,
  ) => {
    let stageChanges = 0;
    const outputs = new Set<string>();
    values.forEach((value, index) => {
      const target = [...path, index];
      if (value.type === "enterStage") {
        stageChanges++;
        if (!own(flow.stages, value.stageId))
          fail(id, [...target, "stageId"], "Unknown stage consequence reference.");
      } else {
        const ids = value.type === "unlockCases" ? value.caseIds : value.chatIds;
        const record = value.type === "unlockCases" ? content.cases : flow.chats;
        const field = value.type === "unlockCases" ? "caseIds" : "chatIds";
        ids.forEach((targetId, position) => {
          if (!Object.hasOwn(record, targetId))
            fail(id, [...target, field, position], "Unknown unlock consequence reference.");
          const key = JSON.stringify([value.type, targetId]);
          if (outputs.has(key))
            fail(id, [...target, field, position], "Duplicate unlock consequence.");
          outputs.add(key);
        });
      }
    });
    if (stageChanges > 1)
      fail(id, path, "A consequence list cannot implicitly choose between multiple stage targets.");
  };
  if (!own(flow.stages, flow.initialStageId))
    fail("flow", [...base, "initialStageId"], "Initial stage must exist.");
  for (const [stageId, stage] of Object.entries(flow.stages)) {
    const path = [...base, "stages", stageId];
    condition(stage.when, [...path, "when"], stageId);
    const ids = new Set<string>();
    stage.transitions.forEach((transition, index) => {
      const target = [...path, "transitions", index];
      if (ids.has(transition.id))
        fail(stageId, [...target, "id"], "Stage transition IDs must be unique locally.");
      ids.add(transition.id);
      condition(transition.when, [...target, "when"], transition.id);
      if (!own(flow.stages, transition.targetStageId))
        fail(transition.id, [...target, "targetStageId"], "Unknown stage transition target.");
    });
  }
  for (const [eventId, event] of Object.entries(flow.events)) {
    const path = [...base, "events", eventId];
    condition(event.when, [...path, "when"], eventId);
    consequences(event.consequences, [...path, "consequences"], eventId);
  }
  for (const [chatId, chat] of Object.entries(flow.chats)) {
    const path = [...base, "chats", chatId];
    if (!characters.has(chat.characterId))
      fail(
        chatId,
        [...path, "characterId"],
        "Chat character must be declared by a case character reference.",
      );
    condition(chat.when, [...path, "when"], chatId);
    if (!own(chat.nodes, chat.startNodeId))
      fail(chatId, [...path, "startNodeId"], "Chat start node must exist locally.");
    const edges = new Map<string, string[]>();
    const exitNodes = new Set<string>();
    for (const [nodeId, node] of Object.entries(chat.nodes)) {
      const target = [...path, "nodes", nodeId];
      const successors: string[] = [];
      if (node.type === "terminal") {
        exitNodes.add(nodeId);
        consequences(node.consequences, [...target, "consequences"], nodeId);
      } else {
        const branchIds = new Set<string>();
        node.externalBranches?.forEach((branch, index) => {
          const branchPath = [...target, "externalBranches", index];
          if (branchIds.has(branch.id))
            fail(nodeId, [...branchPath, "id"], "External branch IDs must be unique locally.");
          branchIds.add(branch.id);
          const event = branch.event;
          const definition = own(content.cases, event.caseId);
          if (!definition)
            fail(
              branch.id,
              [...branchPath, "event", "caseId"],
              "Unknown external business-event case.",
            );
          else if (
            event.type === "caseResolved" &&
            !own(definition.resolutions, event.resolutionId)
          )
            fail(
              branch.id,
              [...branchPath, "event", "resolutionId"],
              "Unknown external business-event resolution.",
            );
          else if (
            event.type === "choiceCompleted" &&
            !own(definition.nodes, event.nodeId)?.choices.some(
              (choice) => choice.id === event.choiceId,
            )
          )
            fail(
              branch.id,
              [...branchPath, "event"],
              "External business event must reference an existing local choice.",
            );
          condition(branch.when, [...branchPath, "when"], branch.id);
          consequences(branch.consequences, [...branchPath, "consequences"], branch.id);
          if (!own(chat.nodes, branch.targetNodeId))
            fail(
              branch.id,
              [...branchPath, "targetNodeId"],
              "External branch target must exist in this chat.",
            );
          else successors.push(branch.targetNodeId);
        });
        const ids = new Set<string>();
        node.replies.forEach((reply, index) => {
          const replyPath = [...target, "replies", index];
          if (ids.has(reply.id))
            fail(nodeId, [...replyPath, "id"], "Reply IDs must be unique locally.");
          ids.add(reply.id);
          condition(reply.when, [...replyPath, "when"], reply.id);
          if (reply.target.type === "node") {
            if (!own(chat.nodes, reply.target.nodeId))
              fail(
                reply.id,
                [...replyPath, "target", "nodeId"],
                "Reply node target must exist in this chat.",
              );
            else successors.push(reply.target.nodeId);
          } else {
            if (!own(flow.events, reply.target.eventId))
              fail(reply.id, [...replyPath, "target", "eventId"], "Reply event target must exist.");
            else exitNodes.add(nodeId);
          }
        });
      }
      edges.set(nodeId, successors);
    }
    const reachable = new Set<string>();
    const pending = [chat.startNodeId];
    while (pending.length) {
      const id = pending.pop()!;
      if (reachable.has(id) || !Object.hasOwn(chat.nodes, id)) continue;
      reachable.add(id);
      pending.push(...(edges.get(id) ?? []));
    }
    // Loops may be authored, but every node must have a structural route to an exit.
    const terminates = new Set(exitNodes);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, successors] of edges)
        if (!terminates.has(id) && successors.some((next) => terminates.has(next))) {
          terminates.add(id);
          changed = true;
        }
    }
    for (const nodeId of Object.keys(chat.nodes)) {
      if (!reachable.has(nodeId))
        fail(chatId, [...path, "nodes", nodeId], "Chat node is unreachable from its local start.");
      if (!terminates.has(nodeId))
        fail(
          chatId,
          [...path, "nodes", nodeId],
          "Chat node has no route to a terminal or external event.",
        );
    }
  }
}

/** Coverage is exact, including terminal copy and every predefined reply in each locale. */
export function validateFlowLocalization(
  content: Readonly<GameContentCatalog>,
  localized: Readonly<LocalizedContentCatalog>,
  add: Collector,
): void {
  const flow = content.configuration?.flow;
  const copy = localized.flow;
  const exact = (
    ids: readonly string[],
    record: Readonly<Record<string, unknown>>,
    path: ContentValidationPath,
    id: string,
  ) => {
    for (const key of ids)
      if (!Object.hasOwn(record, key))
        add("LOCALIZATION_ID_MISSING", id, [...path, key], `Missing flow copy ${key}.`);
    for (const key of Object.keys(record))
      if (!ids.includes(key))
        add("LOCALIZATION_ID_EXTRA", id, [...path, key], `Unknown flow copy ${key}.`);
  };
  if (!flow) {
    if (copy !== undefined)
      add("CONFIGURATION_INVALID", "flow", ["flow"], "Flow copy requires flow configuration.");
    return;
  }
  exact(Object.keys(flow.stages), copy?.stages ?? {}, ["flow", "stages"], "flow");
  exact(Object.keys(flow.chats), copy?.chats ?? {}, ["flow", "chats"], "flow");
  for (const [chatId, chat] of Object.entries(flow.chats)) {
    const chatCopy = copy && own(copy.chats, chatId);
    if (!chatCopy) continue;
    exact(Object.keys(chat.nodes), chatCopy.nodes, ["flow", "chats", chatId, "nodes"], chatId);
    for (const [nodeId, node] of Object.entries(chat.nodes)) {
      const nodeCopy = own(chatCopy.nodes, nodeId);
      if (nodeCopy)
        exact(
          node.type === "message" ? node.replies.map((reply) => reply.id) : [],
          nodeCopy.replies,
          ["flow", "chats", chatId, "nodes", nodeId, "replies"],
          nodeId,
        );
    }
  }
}
