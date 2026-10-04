import { z } from "zod";
import {
  ActionKind,
  AssetKind,
  CaseEventKind,
  DispatchStrategy,
  EffectKind,
  EffectOwner,
  PredicateKind,
  type Tables,
} from "../../content-authoring/generated/schema5";
import {
  ActionInputStepSchema,
  GameContentCatalogSchema,
  GameStoryStepSchema,
  type CaseEvent,
  type Condition,
  type GameEffects,
  type Predicate,
  type GameStoryDefinition,
} from "../../src/content/schema";
import { assemble, AuthoringError, parseSource, type SourceLocation } from "./assemble";

const StorySourceSchema = z.strictObject({
  skippable: z.boolean(),
  steps: z
    .array(
      z.discriminatedUnion("type", [
        ActionInputStepSchema.omit({ targetActionId: true, wrongEffects: true }),
        ...GameStoryStepSchema.options.slice(1),
      ]),
    )
    .min(1),
});
const Rules5SourceSchema = z.strictObject({
  stories: z.record(z.string().min(1), StorySourceSchema),
  endings: GameContentCatalogSchema.shape.endings,
  assets: GameContentCatalogSchema.shape.assets,
  flow: GameContentCatalogSchema.shape.configuration.unwrap().shape.flow,
  initialStoryIds: z.array(z.string().min(1)).optional(),
  unlockRules: GameContentCatalogSchema.shape.unlockRules.optional(),
  storyRules: GameContentCatalogSchema.shape.storyRules.optional(),
});

/** Versioned author model preserves the independently checkable schema-4 CSV entry. */
export function assemble5(tables: Tables, manifest: unknown, rawRules: unknown) {
  const rules = parseSource(Rules5SourceSchema, rawRules, "rules.json");
  const tableRows = {
    attribute: tables.TbAttribute.getDataList(),
    case: tables.TbCase.getDataList(),
    node: tables.TbNode.getDataList(),
    choice: tables.TbChoice.getDataList(),
    resolution: tables.TbResolution.getDataList(),
    effect: tables.TbEffect.getDataList(),
    flag: tables.TbFlag.getDataList(),
    predicate: tables.TbPredicate.getDataList(),
    instruction: tables.TbInstruction.getDataList(),
    hook: tables.TbHook.getDataList(),
    poolMember: tables.TbPoolMember.getDataList(),
    dispatch: tables.TbDispatch.getDataList(),
    actionInput: tables.TbActionInput.getDataList(),
    character: tables.TbCharacter.getDataList(),
    caseCharacter: tables.TbCaseCharacter.getDataList(),
    asset: tables.TbAsset.getDataList(),
  };
  const location = (table: string, id: string, field: string): SourceLocation => {
    const rows = tableRows[table as keyof typeof tableRows];
    const index = rows.findIndex((row) => row.id === id);
    const columns = index >= 0 ? Object.keys(rows[index]) : [];
    const columnIndex = columns.indexOf(field) + 2;
    return {
      file: "Data/sample.xlsx",
      sheet: table,
      row: index + 4,
      column: columnIndex > 1 ? String.fromCharCode(64 + columnIndex) : undefined,
      objectId: id,
      field,
    };
  };
  const fail = (table: string, id: string, field: string, message: string): never => {
    throw new AuthoringError(location(table, id, field), message);
  };
  const eventFor = (
    table: "hook" | "dispatch",
    row: Tables["TbHook"]["getDataList"] extends () => (infer Row)[]
      ? Omit<Row, "storyId" | "resolve">
      : never,
  ): CaseEvent => {
    if (row.eventKind === CaseEventKind.CaseStarted) {
      if (row.nodeId || row.choiceId || row.resolutionId)
        fail(table, row.id, "eventKind", "CaseStarted must leave choice/resolution fields empty.");
      return { type: "caseStarted", caseId: row.caseId };
    }
    if (row.eventKind === CaseEventKind.ChoiceCompleted) {
      if (row.resolutionId)
        fail(table, row.id, "resolutionId", "ChoiceCompleted must leave resolutionId empty.");
      return {
        type: "choiceCompleted",
        caseId: row.caseId,
        nodeId: row.nodeId,
        choiceId: row.choiceId,
      };
    }
    if (row.eventKind === CaseEventKind.CaseResolved) {
      if (row.nodeId || row.choiceId)
        fail(table, row.id, "eventKind", "CaseResolved must leave choice fields empty.");
      return { type: "caseResolved", caseId: row.caseId, resolutionId: row.resolutionId };
    }
    return fail(table, row.id, "eventKind", "Unsupported business event.");
  };
  const conditions = new Map<string, Condition>();
  const usedConditions = new Set<string>();
  for (const row of tableRows.predicate) {
    let predicate: Predicate;
    let activeFields: readonly string[];
    switch (row.kind) {
      case PredicateKind.CaseResolved:
        predicate = {
          type: "caseResolved",
          caseId: row.caseId,
          ...(row.resolutionId ? { resolutionId: row.resolutionId } : {}),
        };
        activeFields = ["caseId", "resolutionId"];
        break;
      case PredicateKind.ResolvedCountAtLeast:
        predicate = { type: "resolvedCountAtLeast", count: row.count };
        activeFields = ["count"];
        break;
      case PredicateKind.AttributeAtLeast:
      case PredicateKind.AttributeAtMost:
        predicate = {
          type:
            row.kind === PredicateKind.AttributeAtLeast ? "attributeAtLeast" : "attributeAtMost",
          attributeId: row.attributeId,
          value: row.value,
        };
        activeFields = ["attributeId", "value"];
        break;
      case PredicateKind.FlagEquals:
        predicate = { type: "flagEquals", flagId: row.flagId, value: row.enabled };
        activeFields = ["flagId", "enabled"];
        break;
      default:
        return fail("predicate", row.id, "kind", "Unsupported predicate.");
    }
    for (const field of [
      "caseId",
      "resolutionId",
      "attributeId",
      "flagId",
      "count",
      "value",
      "enabled",
    ] as const)
      if (!activeFields.includes(field) && row[field])
        fail("predicate", row.id, field, "Inactive predicate fields must remain empty/zero/false.");
    const condition = conditions.get(row.conditionId) ?? { all: [] };
    condition.all.push(predicate);
    conditions.set(row.conditionId, condition);
  }
  const conditionFor = (table: string, id: string, conditionId: string) => {
    usedConditions.add(conditionId);
    return (
      conditions.get(conditionId) ??
      fail(table, id, "conditionId", `Unknown condition ${conditionId}.`)
    );
  };
  const wrongEffects = new Map<string, GameEffects>();
  const resolutionEffects: ReturnType<Tables["TbEffect"]["getDataList"]> = [];
  for (const row of tableRows.effect) {
    if (row.ownerKind === EffectOwner.Resolution) {
      if (row.storyId || row.stepId)
        fail("effect", row.id, "ownerKind", "Resolution effects cannot name a story step.");
      resolutionEffects.push(row);
      continue;
    }
    if (row.ownerKind !== EffectOwner.ActionInput || row.caseId || row.resolutionId)
      fail("effect", row.id, "ownerKind", "ActionInput effects cannot name a verdict.");
    const step = Object.hasOwn(rules.stories, row.storyId)
      ? rules.stories[row.storyId].steps.find((step) => step.id === row.stepId)
      : undefined;
    if (step?.type !== "actionInput")
      fail("effect", row.id, "stepId", "Effects must reference an authored actionInput step.");
    const key = JSON.stringify([row.storyId, row.stepId]);
    const effects = wrongEffects.get(key) ?? {
      attributeDeltas: Object.create(null),
      setFlags: Object.create(null),
    };
    if (row.kind === EffectKind.AttributeDelta) {
      if (row.enabled) fail("effect", row.id, "enabled", "AttributeDelta requires enabled=false.");
      if (Object.hasOwn(effects.attributeDeltas, row.key))
        fail("effect", row.id, "key", "Duplicate attribute effect.");
      effects.attributeDeltas[row.key] = row.amount;
    } else if (row.kind === EffectKind.SetFlag) {
      if (row.amount) fail("effect", row.id, "amount", "SetFlag requires amount=0.");
      if (Object.hasOwn(effects.setFlags, row.key))
        fail("effect", row.id, "key", "Duplicate flag effect.");
      effects.setFlags[row.key] = row.enabled;
    } else fail("effect", row.id, "kind", "Unsupported effect kind.");
    wrongEffects.set(key, effects);
  }
  const actions = new Map<string, "salute" | "wave">();
  for (const row of tableRows.actionInput) {
    const step = Object.hasOwn(rules.stories, row.storyId)
      ? rules.stories[row.storyId].steps.find((step) => step.id === row.stepId)
      : undefined;
    if (step?.type !== "actionInput")
      fail(
        "actionInput",
        row.id,
        "stepId",
        "Action requirement must reference an authored actionInput step.",
      );
    const key = JSON.stringify([row.storyId, row.stepId]);
    if (actions.has(key))
      fail("actionInput", row.id, "stepId", "Action step must have one requirement.");
    actions.set(
      key,
      row.targetActionId === ActionKind.Salute
        ? "salute"
        : row.targetActionId === ActionKind.Wave
          ? "wave"
          : fail("actionInput", row.id, "targetActionId", "Unsupported action."),
    );
  }
  const stories = Object.fromEntries(
    Object.entries(rules.stories).map(([storyId, story]): [string, GameStoryDefinition] => [
      storyId,
      {
        ...story,
        steps: story.steps.map((step) => {
          if (step.type !== "actionInput") return step;
          const key = JSON.stringify([storyId, step.id]);
          const targetActionId = actions.get(key);
          if (!targetActionId)
            throw new AuthoringError(
              { file: "rules.json", objectId: storyId, field: `steps.${step.id}` },
              "ActionInput has no table requirement.",
            );
          return {
            ...step,
            targetActionId,
            ...(wrongEffects.has(key) ? { wrongEffects: wrongEffects.get(key)! } : {}),
          };
        }),
      },
    ]),
  );
  if (Object.keys(rules.assets).length)
    throw new AuthoringError(
      { file: "rules.json", objectId: "assets", field: "assets" },
      "Schema5 assets must be authored in the asset sheet, not duplicated in rules.",
    );
  const { flow, initialStoryIds, unlockRules, storyRules, ...baseRules } = rules;
  const assets = Object.fromEntries(
    tableRows.asset.map((row) => [
      row.id,
      {
        kind:
          row.kind === AssetKind.Image
            ? ("image" as const)
            : row.kind === AssetKind.Audio
              ? ("audio" as const)
              : row.kind === AssetKind.Video
                ? ("video" as const)
                : fail("asset", row.id, "kind", "Unsupported asset kind."),
        path: row.path,
      },
    ]),
  );
  const result = assemble(
    {
      TbAttribute: tables.TbAttribute,
      TbCase: tables.TbCase,
      TbNode: tables.TbNode,
      TbChoice: tables.TbChoice,
      TbResolution: tables.TbResolution,
      TbEffect: { getDataList: () => resolutionEffects },
    },
    manifest,
    {
      ...baseRules,
      assets,
      stories,
      initial: {
        storyIds: initialStoryIds ?? [],
        flags: Object.fromEntries(tableRows.flag.map((row) => [row.id, row.initial])),
      },
      unlockRules: unlockRules ?? [],
      storyRules: storyRules ?? [],
    },
    location,
  );
  const configuration: NonNullable<typeof result.game.configuration> = {
    ...(flow === undefined ? {} : { flow }),
    interactionOnly: {
      attributeIds: tableRows.attribute.filter((row) => row.interactionOnly).map((row) => row.id),
      flagIds: tableRows.flag.filter((row) => row.interactionOnly).map((row) => row.id),
    },
    instructions: Object.fromEntries(
      tableRows.instruction.map((row) => [
        row.id,
        { caseId: row.caseId, nodeId: row.nodeId, choiceId: row.choiceId, delayMs: row.delayMs },
      ]),
    ),
    actionInputHooks: tableRows.hook.map((row) => ({
      id: row.id,
      event: eventFor("hook", row),
      storyId: row.storyId,
    })),
    casePools: Object.create(null),
    dispatchRules: [],
  };
  for (const row of tableRows.poolMember) {
    const pool = configuration.casePools[row.poolId] ?? { members: [] };
    pool.members.push({
      caseId: row.caseId,
      when: conditionFor("poolMember", row.id, row.conditionId),
    });
    configuration.casePools[row.poolId] = pool;
  }
  configuration.dispatchRules = tableRows.dispatch.map((row) => {
    if (row.strategyKind !== DispatchStrategy.Ordered)
      return fail(
        "dispatch",
        row.id,
        "strategyKind",
        "An explicit supported dispatch strategy is required.",
      );
    const members = tableRows.poolMember.filter((member) => member.poolId === row.poolId);
    if (new Set(members.map((member) => member.rank)).size !== members.length)
      fail("dispatch", row.id, "poolId", "Ordered pool ranks must be distinct.");
    return {
      id: row.id,
      event: eventFor("dispatch", row),
      when: conditionFor("dispatch", row.id, row.conditionId),
      poolId: row.poolId,
      strategy: {
        type: "ordered",
        caseIds: members
          .sort((left, right) => left.rank - right.rank)
          .map((member) => member.caseId),
      },
    };
  });
  for (const row of tableRows.predicate)
    if (!usedConditions.has(row.conditionId))
      fail("predicate", row.id, "conditionId", "Unused condition would be silently ignored.");
  result.game.configuration = configuration;
  const bind = (table: string, id: string, path: (string | number)[], field = "id") =>
    result.mappings.push({ path, location: location(table, id, field) });
  const referencedCharacters = new Set<string>();
  for (const row of tableRows.caseCharacter) {
    const definition = Object.hasOwn(result.game.cases, row.caseId)
      ? result.game.cases[row.caseId]
      : undefined;
    if (!definition)
      return fail("caseCharacter", row.id, "caseId", "Unknown case character owner.");
    const character = tableRows.character.find((candidate) => candidate.id === row.characterId);
    if (!character)
      return fail("caseCharacter", row.id, "characterId", "Unknown author character.");
    if (definition.characters.some((existing) => existing.id === row.characterId))
      fail("caseCharacter", row.id, "characterId", "Duplicate character in this case.");
    const index = definition.characters.length;
    definition.characters.push({
      id: character.id,
      ...(character.portraitAssetId ? { portraitAssetId: character.portraitAssetId } : {}),
    });
    referencedCharacters.add(character.id);
    bind("caseCharacter", row.id, ["cases", row.caseId, "characters", index], "characterId");
    bind(
      "character",
      character.id,
      ["cases", row.caseId, "characters", index, "portraitAssetId"],
      "portraitAssetId",
    );
  }
  for (const row of tableRows.character)
    if (!referencedCharacters.has(row.id))
      fail(
        "character",
        row.id,
        "id",
        "Character has no case reference and would be silently unused.",
      );
  for (const row of tableRows.asset) {
    bind("asset", row.id, ["assets", row.id]);
    bind("asset", row.id, ["assets", row.id, "path"], "path");
    bind("asset", row.id, ["assets", row.id, "kind"], "kind");
  }
  // Structured flow text has exact JSON field origins, including predicates and consequences.
  const bindFlow = (value: unknown, path: (string | number)[] = []) => {
    const objectId = String(path[1] ?? "flow");
    result.mappings.push({
      path: ["configuration", "flow", ...path],
      location: { file: "rules.json", objectId, field: ["flow", ...path].join(".") },
    });
    if (Array.isArray(value)) value.forEach((child, index) => bindFlow(child, [...path, index]));
    else if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) bindFlow(child, [...path, key]);
  };
  if (flow !== undefined) bindFlow(flow);
  if (initialStoryIds !== undefined)
    result.mappings.push({
      path: ["initial", "storyIds"],
      location: { file: "rules.json", objectId: "initialStoryIds", field: "initialStoryIds" },
    });
  for (const row of tableRows.flag) {
    bind("flag", row.id, ["initial", "flags", row.id], "initial");
  }
  for (const row of tableRows.attribute)
    for (const field of ["initial", "min", "max"])
      bind("attribute", row.id, ["attributes", row.id, field], field);
  for (const row of tableRows.instruction) {
    bind("instruction", row.id, ["configuration", "instructions", row.id]);
    for (const field of ["caseId", "nodeId", "choiceId", "delayMs"])
      bind("instruction", row.id, ["configuration", "instructions", row.id, field], field);
  }
  tableRows.hook.forEach((row, index) => {
    bind("hook", row.id, ["configuration", "actionInputHooks", index]);
    bind("hook", row.id, ["configuration", "actionInputHooks", index, "storyId"], "storyId");
    bind("hook", row.id, ["configuration", "actionInputHooks", index, "event"], "eventKind");
  });
  tableRows.dispatch.forEach((row, index) => {
    bind("dispatch", row.id, ["configuration", "dispatchRules", index]);
    bind("dispatch", row.id, ["configuration", "dispatchRules", index, "poolId"], "poolId");
    bind("dispatch", row.id, ["configuration", "dispatchRules", index, "strategy"], "strategyKind");
  });
  for (const [poolId, pool] of Object.entries(configuration.casePools))
    pool.members.forEach((member, index) => {
      const row = tableRows.poolMember.find(
        (row) => row.poolId === poolId && row.caseId === member.caseId,
      )!;
      bind(
        "poolMember",
        row.id,
        ["configuration", "casePools", poolId, "members", index],
        "caseId",
      );
    });
  // Conditions are shared by stable ID; copy each predicate's physical origin to every runtime use.
  const bindCondition = (condition: Condition, path: (string | number)[]) =>
    condition.all.forEach((predicate, index) => {
      const row = tableRows.predicate.find((row) =>
        conditions.get(row.conditionId)?.all.includes(predicate),
      )!;
      bind("predicate", row.id, [...path, "all", index], "kind");
      for (const field of ["caseId", "resolutionId", "attributeId", "flagId", "count", "value"])
        bind(
          "predicate",
          row.id,
          [...path, "all", index, field],
          field === "value" && predicate.type === "flagEquals" ? "enabled" : field,
        );
    });
  for (const [id, pool] of Object.entries(configuration.casePools))
    pool.members.forEach((member, index) =>
      bindCondition(member.when, ["configuration", "casePools", id, "members", index, "when"]),
    );
  configuration.dispatchRules.forEach((rule, index) =>
    bindCondition(rule.when, ["configuration", "dispatchRules", index, "when"]),
  );
  for (const row of tableRows.effect.filter((row) => row.ownerKind === EffectOwner.ActionInput)) {
    const stepIndex = stories[row.storyId].steps.findIndex((step) => step.id === row.stepId);
    bind(
      "effect",
      row.id,
      [
        "stories",
        row.storyId,
        "steps",
        stepIndex,
        "wrongEffects",
        row.kind === EffectKind.AttributeDelta ? "attributeDeltas" : "setFlags",
        row.key,
      ],
      "key",
    );
  }
  return result;
}
