import type { GameContentCatalog, LocalizedContentCatalog, MainFlowCondition } from "./schema";
import type { ContentValidationIssueCode, ContentValidationPath } from "./validate";
type Collector = (
  code: ContentValidationIssueCode,
  id: string,
  path: ContentValidationPath,
  message: string,
) => void;
const own = <T>(record: Readonly<Record<string, T>>, id: string): T | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

/** Validate the complete finite graph before executing any authored intent. */
export function validateMainFlow(content: Readonly<GameContentCatalog>, add: Collector): void {
  const flow = content.mainFlow;
  if (!flow) return;
  const fail = (id: string, path: ContentValidationPath, message: string) =>
    add("CONFIGURATION_INVALID", id, path, message);
  if (
    content.unlockRules.length ||
    content.configuration!.dispatchRules.length ||
    content.initial.caseIds.length ||
    Object.keys(content.configuration!.casePools).length
  )
    fail(
      "mainFlow",
      ["mainFlow"],
      "Schema 6 dispatch is exclusively mainFlow: legacy unlockRules, dispatchRules, casePools and initial.caseIds must be empty.",
    );
  const instances = new Map<string, string>();
  const characters = new Set(
    Object.values(content.cases).flatMap((c) => c.characters.map((c) => c.id)),
  );
  const results = new Map<string, Set<string>>();
  for (const [id, chat] of Object.entries(flow.chats)) {
    const base = ["mainFlow", "chats", id];
    if (!characters.has(chat.characterId))
      fail(id, [...base, "characterId"], "Unknown character reference.");
    const terminal = new Set(
      Object.values(chat.nodes).flatMap((n) => (n.type === "terminal" ? [n.resultId] : [])),
    );
    results.set(id, new Set([...terminal, ...(chat.inactivity ? [chat.inactivity.resultId] : [])]));
    if (!own(chat.nodes, chat.startNodeId))
      fail(id, [...base, "startNodeId"], "Unknown chat start node.");
    const reachable = new Set<string>();
    const visit = (nodeId: string) => {
      if (reachable.has(nodeId)) return;
      const node = own(chat.nodes, nodeId);
      if (!node) return;
      reachable.add(nodeId);
      if (node.type === "message") node.replies.forEach((r) => visit(r.targetNodeId));
    };
    visit(chat.startNodeId);
    const terminates = new Set(
      Object.keys(chat.nodes).filter((n) => chat.nodes[n].type === "terminal"),
    );
    let changed = true;
    while (changed) {
      changed = false;
      for (const [nodeId, node] of Object.entries(chat.nodes))
        if (
          !terminates.has(nodeId) &&
          node.type === "message" &&
          node.replies.some((r) => terminates.has(r.targetNodeId))
        ) {
          terminates.add(nodeId);
          changed = true;
        }
    }
    for (const [nodeId, node] of Object.entries(chat.nodes)) {
      const path = [...base, "nodes", nodeId];
      if (!reachable.has(nodeId)) fail(id, path, "Unreachable chat node.");
      if (!terminates.has(nodeId)) fail(id, path, "Chat node has no route to a terminal result.");
      if (node.type === "message") {
        const replies = new Set<string>();
        node.replies.forEach((r, index) => {
          if (replies.has(r.id)) fail(id, [...path, "replies", index], "Duplicate reply ID.");
          replies.add(r.id);
          if (!own(chat.nodes, r.targetNodeId))
            fail(id, [...path, "replies", index, "targetNodeId"], "Unknown local reply target.");
        });
      }
    }
  }
  for (const [id, node] of Object.entries(flow.nodes)) {
    const base = ["mainFlow", "nodes", id];
    if (
      node.onEnter.filter((i) => i.type === "dispatchCase" || i.type === "dispatchPool").length > 1
    )
      fail(id, [...base, "onEnter"], "A node may declare only one dispatch intent.");
    node.onEnter.forEach((intent, index) => {
      const path = [...base, "onEnter", index];
      switch (intent.type) {
        case "startChat":
          if (instances.has(intent.instanceId))
            fail(id, path, "Chat instance ID must be declared exactly once.");
          instances.set(intent.instanceId, intent.chatId);
          if (!own(flow.chats, intent.chatId))
            fail(id, [...path, "chatId"], "Unknown chat template.");
          break;
        case "dispatchCase":
          if (!own(content.cases, intent.caseId)) fail(id, path, "Unknown dispatched case.");
          break;
        case "publishNews":
          if (!own(flow.news, intent.newsId)) fail(id, path, "Unknown news.");
          break;
        case "openPool":
        case "dispatchPool": {
          const pool = own(flow.casePools, intent.poolId);
          if (!pool) fail(id, path, "Unknown pool.");
          if (intent.type === "dispatchPool" && pool) {
            const ids = intent.strategy.caseIds;
            if (
              new Set(ids).size !== ids.length ||
              ids.length !== pool.members.length ||
              pool.members.some((m) => !ids.includes(m.caseId))
            )
              fail(
                id,
                [...path, "strategy"],
                "Ordered strategy must name every pool member exactly once.",
              );
          }
          break;
        }
      }
    });
  }
  const condition = (when: MainFlowCondition, path: ContentValidationPath, id: string) => {
    const op = "all" in when ? "all" : "any";
    const predicates = "all" in when ? when.all : when.any;
    predicates.forEach((p, index) => {
      const at = [...path, op, index];
      switch (p.type) {
        case "mainNode":
          if (!own(flow.nodes, p.nodeId)) fail(id, at, "Unknown main node predicate.");
          break;
        case "chatResult":
          if (!results.get(instances.get(p.instanceId) ?? "")?.has(p.resultId))
            fail(id, at, "Unknown chat instance or result reference.");
          break;
        case "caseResolved": {
          const c = own(content.cases, p.caseId);
          if (!c || (p.resolutionId !== undefined && !own(c.resolutions, p.resolutionId)))
            fail(id, at, "Unknown case or resolution predicate.");
          break;
        }
        case "attributeAtLeast":
        case "attributeAtMost":
          if (!own(content.attributes, p.attributeId)) fail(id, at, "Unknown attribute predicate.");
          if (content.configuration!.interactionOnly.attributeIds.includes(p.attributeId))
            fail(id, at, "Main flow cannot read interaction-only attributes.");
          break;
        case "flagEquals":
          if (!Object.hasOwn(content.initial.flags, p.flagId))
            fail(id, at, "Unknown flag predicate.");
          if (content.configuration!.interactionOnly.flagIds.includes(p.flagId))
            fail(id, at, "Main flow cannot read interaction-only flags.");
          break;
        case "resolvedCountAtLeast":
          break;
      }
    });
  };
  for (const [id, pool] of Object.entries(flow.casePools)) {
    const seen = new Set<string>();
    pool.members.forEach((m, i) => {
      const path = ["mainFlow", "casePools", id, "members", i];
      if (!own(content.cases, m.caseId) || seen.has(m.caseId))
        fail(id, path, "Unknown or duplicate pool case.");
      seen.add(m.caseId);
      condition(m.when, [...path, "when"], id);
    });
  }
  const colors = new Map<string, number>();
  const visit = (id: string) => {
    if (colors.get(id) === 1) {
      fail(id, ["mainFlow", "nodes", id], "Main graph must be a DAG; cycle found.");
      return;
    }
    if (colors.has(id) || !own(flow.nodes, id)) return;
    colors.set(id, 1);
    flow.nodes[id].transitions.forEach((t) => visit(t.targetNodeId));
    colors.set(id, 2);
  };
  if (!own(flow.nodes, flow.initialNodeId))
    fail("mainFlow", ["mainFlow", "initialNodeId"], "Unknown initial main node.");
  visit(flow.initialNodeId);
  for (const [id, node] of Object.entries(flow.nodes)) {
    const path = ["mainFlow", "nodes", id];
    if (!colors.has(id)) {
      fail(id, path, "Unreachable main node.");
      visit(id);
    }
    const seen = new Set<string>();
    node.transitions.forEach((t, i) => {
      const at = [...path, "transitions", i];
      if (seen.has(t.id)) fail(id, at, "Duplicate transition ID.");
      seen.add(t.id);
      if (!own(flow.nodes, t.targetNodeId))
        fail(id, [...at, "targetNodeId"], "Unknown transition target.");
      condition(t.when, [...at, "when"], id);
    });
  }
  const usedStories = new Map<string, string[]>();
  const use = (storyId: string, source: string) =>
    usedStories.set(storyId, [...(usedStories.get(storyId) ?? []), source]);
  content.initial.storyIds.forEach((id) => use(id, "initial.storyIds"));
  content.storyRules.forEach((r) => use(r.storyId, `storyRules.${r.id}`));
  content.configuration!.actionInputHooks.forEach((h) =>
    use(h.storyId, `actionInputHooks.${h.id}`),
  );
  Object.entries(content.endings).forEach(([id, e]) => use(e.storyId, `endings.${id}`));
  if (flow.tutorialStoryId) {
    if (!own(content.stories, flow.tutorialStoryId))
      fail("mainFlow", ["mainFlow", "tutorialStoryId"], "Unknown tutorial story.");
    use(flow.tutorialStoryId, "mainFlow.tutorialStoryId");
  }
  Object.entries(flow.news).forEach(([id, news]) => {
    if (news.actionStoryId) use(news.actionStoryId, `mainFlow.news.${id}`);
  });
  if (flow.tutorialStoryId) {
    const owners = usedStories.get(flow.tutorialStoryId)!;
    if (owners.length > 1)
      fail(
        "mainFlow",
        ["mainFlow", "tutorialStoryId"],
        `Tutorial story must be exclusive; shared by ${owners.join(", ")}.`,
      );
  }
  for (const [id, news] of Object.entries(flow.news))
    if (news.actionStoryId) {
      const story = own(content.stories, news.actionStoryId);
      const at = ["mainFlow", "news", id, "actionStoryId"];
      if (!story || story.skippable || !story.steps.some((s) => s.type === "actionInput"))
        fail(id, at, "News action must reference an unskippable actionInput story.");
      const owners = usedStories.get(news.actionStoryId)!;
      if (owners.length > 1)
        fail(id, at, `News action story must be exclusive; shared by ${owners.join(", ")}.`);
    }
}

export function validateMainFlowLocalization(
  content: Readonly<GameContentCatalog>,
  localized: Readonly<LocalizedContentCatalog>,
  add: Collector,
): void {
  const flow = content.mainFlow,
    copy = localized.mainFlow;
  const exact = (
    ids: string[],
    record: Readonly<Record<string, unknown>>,
    path: ContentValidationPath,
  ) => {
    for (const id of ids)
      if (!Object.hasOwn(record, id))
        add("LOCALIZATION_ID_MISSING", id, [...path, id], "Missing main-flow copy.");
    for (const id of Object.keys(record))
      if (!ids.includes(id))
        add("LOCALIZATION_ID_EXTRA", id, [...path, id], "Unknown main-flow copy.");
  };
  if (!flow) {
    if (copy)
      add(
        "CONFIGURATION_INVALID",
        "mainFlow",
        ["mainFlow"],
        "Main-flow copy requires schema 6 mainFlow.",
      );
    return;
  }
  exact(Object.keys(flow.chats), copy?.chats ?? {}, ["mainFlow", "chats"]);
  exact(Object.keys(flow.news), copy?.news ?? {}, ["mainFlow", "news"]);
  for (const [id, chat] of Object.entries(flow.chats)) {
    const c = copy && own(copy.chats, id);
    if (!c) continue;
    exact(Object.keys(chat.nodes), c.nodes, ["mainFlow", "chats", id, "nodes"]);
    for (const [nodeId, node] of Object.entries(chat.nodes)) {
      const n = own(c.nodes, nodeId);
      if (n)
        exact(node.type === "message" ? node.replies.map((r) => r.id) : [], n.replies, [
          "mainFlow",
          "chats",
          id,
          "nodes",
          nodeId,
          "replies",
        ]);
    }
  }
}
