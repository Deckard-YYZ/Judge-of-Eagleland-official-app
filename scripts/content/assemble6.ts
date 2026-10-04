import { z } from "zod";
import type { Tables } from "../../content-authoring/generated/schema6";
import type { Tables as Tables5 } from "../../content-authoring/generated/schema5";
import {
  MainFlowConditionSchema,
  MainFlowDefinitionSchema,
  MainFlowIntentSchema,
} from "../../src/content/schema";
import { AuthoringError, parseSource, type SourceLocation } from "./assemble";
import { assemble5 } from "./assemble5";

/** Base sheets retain their schema-5 contract; main-flow sheets own all controller data. */
export function assemble6(tables: Tables, base: Tables5, manifest: unknown, rawRules: unknown) {
  const chatNodesSchema = z.record(
    z.string().min(1),
    MainFlowDefinitionSchema.shape.chats.valueType.shape.nodes,
  );
  const rules = parseSource(
    z.object({ chatNodes: chatNodesSchema }).passthrough(),
    rawRules,
    "rules.json",
  );
  const { chatNodes, ...baseRules } = rules;
  const result = assemble5(base, manifest, baseRules);
  const rows = {
    mainNode: tables.TbMainNode.getDataList(),
    mainTransition: tables.TbMainTransition.getDataList(),
    mainIntent: tables.TbMainIntent.getDataList(),
    mainChat: tables.TbMainChat.getDataList(),
    mainPoolMember: tables.TbMainPoolMember.getDataList(),
    mainNews: tables.TbMainNews.getDataList(),
    mainSetting: tables.TbMainSetting.getDataList(),
  };
  type Sheet = keyof typeof rows;
  const location = (sheet: Sheet, id: string, field: string): SourceLocation => ({
    file: "Data/sample.xlsx",
    sheet,
    row: rows[sheet].findIndex((r) => r.id === id) + 4,
    column: String.fromCharCode(
      66 + Object.keys(rows[sheet].find((r) => r.id === id) ?? {}).indexOf(field),
    ),
    objectId: id,
    field,
  });
  const fail = (sheet: Sheet, id: string, field: string, message: string): never => {
    throw new AuthoringError(location(sheet, id, field), message);
  };
  const bind = (sheet: Sheet, id: string, field: string, path: (string | number)[]) =>
    result.mappings.push({ path, location: location(sheet, id, field) });
  const cell = <T>(
    sheet: Sheet,
    id: string,
    field: string,
    value: string,
    schema: z.ZodType<T>,
  ): T => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return fail(sheet, id, field, "Invalid JSON cell.");
    }
    const check = schema.safeParse(parsed);
    if (!check.success)
      return fail(
        sheet,
        id,
        field,
        check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    return check.data;
  };
  const initial = rows.mainNode.filter((r) => r.initial);
  if (initial.length !== 1)
    fail("mainNode", "initial", "initial", "Exactly one main node must be initial.");
  const flow: z.infer<typeof MainFlowDefinitionSchema> = {
    initialNodeId: initial[0].id,
    nodes: {},
    chats: {},
    casePools: {},
    news: {},
  };
  for (const row of rows.mainNode) {
    flow.nodes[row.id] = { stageId: row.stageId, onEnter: [], transitions: [] };
    bind("mainNode", row.id, "id", ["mainFlow", "nodes", row.id]);
  }
  const nodeFor = (sheet: Sheet, id: string, nodeId: string) =>
    flow.nodes[nodeId] ?? fail(sheet, id, "nodeId", `Unknown main node ${nodeId}.`);
  for (const row of rows.mainIntent) {
    const node = nodeFor("mainIntent", row.id, row.nodeId),
      index = node.onEnter.length;
    node.onEnter.push(
      cell("mainIntent", row.id, "definition", row.definition, MainFlowIntentSchema),
    );
    bind("mainIntent", row.id, "definition", ["mainFlow", "nodes", row.nodeId, "onEnter", index]);
  }
  for (const row of rows.mainTransition) {
    const node = nodeFor("mainTransition", row.id, row.nodeId),
      index = node.transitions.length;
    node.transitions.push({
      id: row.id,
      targetNodeId: row.targetNodeId,
      when: cell("mainTransition", row.id, "when", row.when, MainFlowConditionSchema),
    });
    bind("mainTransition", row.id, "when", ["mainFlow", "nodes", row.nodeId, "transitions", index]);
    bind("mainTransition", row.id, "targetNodeId", [
      "mainFlow",
      "nodes",
      row.nodeId,
      "transitions",
      index,
      "targetNodeId",
    ]);
  }
  for (const row of rows.mainChat) {
    if (!Object.hasOwn(chatNodes, row.id))
      fail("mainChat", row.id, "id", "Missing structured local graph in rules.chatNodes.");
    if ((row.choiceThreshold === 0) !== (row.inactivityResultId === ""))
      fail(
        "mainChat",
        row.id,
        "choiceThreshold",
        "Threshold and inactivity result must both be provided, or both absent (0 / empty).",
      );
    flow.chats[row.id] = {
      characterId: row.characterId,
      startNodeId: row.startNodeId,
      nodes: chatNodes[row.id],
      ...(row.choiceThreshold
        ? { inactivity: { choiceThreshold: row.choiceThreshold, resultId: row.inactivityResultId } }
        : {}),
    };
    bind("mainChat", row.id, "id", ["mainFlow", "chats", row.id]);
    const bindLocal = (value: unknown, path: (string | number)[] = []) => {
      result.mappings.push({
        path: ["mainFlow", "chats", row.id, "nodes", ...path],
        location: {
          file: "rules.json",
          objectId: row.id,
          field: ["chatNodes", row.id, ...path].join("."),
        },
      });
      if (Array.isArray(value)) value.forEach((child, index) => bindLocal(child, [...path, index]));
      else if (value && typeof value === "object")
        for (const [key, child] of Object.entries(value)) bindLocal(child, [...path, key]);
    };
    bindLocal(chatNodes[row.id]);
  }
  for (const id of Object.keys(chatNodes))
    if (!Object.hasOwn(flow.chats, id))
      throw new AuthoringError(
        { file: "rules.json", objectId: id, field: `chatNodes.${id}` },
        "Local graph has no mainChat row.",
      );
  for (const row of rows.mainPoolMember) {
    const pool = flow.casePools[row.poolId] ?? { members: [] };
    bind("mainPoolMember", row.id, "when", [
      "mainFlow",
      "casePools",
      row.poolId,
      "members",
      pool.members.length,
    ]);
    pool.members.push({
      caseId: row.caseId,
      when: cell("mainPoolMember", row.id, "when", row.when, MainFlowConditionSchema),
    });
    flow.casePools[row.poolId] = pool;
  }
  for (const row of rows.mainNews) {
    flow.news[row.id] = row.actionStoryId ? { actionStoryId: row.actionStoryId } : {};
    bind("mainNews", row.id, "actionStoryId", ["mainFlow", "news", row.id]);
  }
  for (const row of rows.mainSetting) {
    if (row.id !== "tutorialStoryId")
      fail("mainSetting", row.id, "id", "Unknown main-flow setting.");
    flow.tutorialStoryId = row.value;
    bind("mainSetting", row.id, "value", ["mainFlow", "tutorialStoryId"]);
  }
  result.game.mainFlow = parseSource(MainFlowDefinitionSchema, flow, "Data/sample.xlsx");
  return result;
}
