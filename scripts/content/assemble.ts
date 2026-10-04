import { z } from "zod";
import { EffectKind, TargetKind, type Tables } from "../../content-authoring/generated/schema";
import {
  GameContentCatalogSchema,
  GameContentManifestSchema,
  InitialGameDefinitionSchema,
  type GameContentCatalog,
} from "../../src/content/schema";
import type { ContentValidationIssue } from "../../src/content/validate";

// Only these structured sections live outside tables. Their contracts are the runtime schemas,
// so adding a rule cannot quietly bypass the same finite condition/effect types used in-game.
export const RulesSourceSchema = z.strictObject({
  unlockRules: GameContentCatalogSchema.shape.unlockRules,
  storyRules: GameContentCatalogSchema.shape.storyRules,
  stories: GameContentCatalogSchema.shape.stories,
  endings: GameContentCatalogSchema.shape.endings,
  assets: GameContentCatalogSchema.shape.assets,
  initial: InitialGameDefinitionSchema.omit({ caseIds: true }),
});
export interface SourceLocation {
  file: string;
  objectId: string;
  field: string;
  sheet?: string;
  row?: number;
  column?: string;
}
export interface SourceMapping {
  path: readonly (string | number)[];
  location: SourceLocation;
}
export class AuthoringError extends Error {
  constructor(
    readonly location: SourceLocation,
    message: string,
  ) {
    super(
      `${location.file}${location.sheet ? ` [${location.sheet}!${location.column ?? ""}${location.row ?? ""}]` : ""} | object=${location.objectId} | field=${location.field} | ${message}`,
    );
  }
}
export function parseSource<T>(schema: z.ZodType<T>, value: unknown, file: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AuthoringError(
      { file, objectId: String(issue.path[0] ?? "package"), field: issue.path.join(".") },
      issue.message,
    );
  }
  return result.data;
}

/** Author tables are compiled data, never player-facing package files. No table is ignored. */
type RowsOnly<T> = T extends { getDataList(): (infer Row)[] }
  ? { getDataList(): Omit<Row, "resolve">[] }
  : never;
export type BaseAuthorTables = {
  [Key in "TbAttribute" | "TbCase" | "TbNode" | "TbChoice" | "TbResolution" | "TbEffect"]: RowsOnly<
    Tables[Key]
  >;
};

export function assemble(
  tables: BaseAuthorTables,
  manifestSource: unknown,
  rulesSource: unknown,
  sourceLocation?: (table: string, id: string, field: string) => SourceLocation,
) {
  const manifest = parseSource(GameContentManifestSchema, manifestSource, "package.json");
  const rules = parseSource(RulesSourceSchema, rulesSource, "rules.json");
  const game: GameContentCatalog = {
    manifest,
    ...rules,
    initial: { ...rules.initial, caseIds: [] },
    attributes: Object.create(null),
    cases: Object.create(null),
  };
  const mappings: SourceMapping[] = [
    { path: [], location: { file: "rules.json", objectId: "package", field: "<root>" } },
    {
      path: ["manifest"],
      location: { file: "package.json", objectId: "manifest", field: "<root>" },
    },
  ];
  const bind = (table: string, id: string, runtimePath: (string | number)[], field = "id") => {
    const location = sourceLocation?.(table, id, field) ?? {
      file: `Data/${table}.csv`,
      objectId: id,
      field,
    };
    mappings.push({ path: runtimePath, location });
    return location;
  };
  const fail = (table: string, id: string, field: string, message: string): never => {
    throw new AuthoringError(
      sourceLocation?.(table, id, field) ?? { file: `Data/${table}.csv`, objectId: id, field },
      message,
    );
  };
  const caseFor = (table: string, row: { id: string; caseId: string }) => {
    const value = game.cases[row.caseId];
    return value ?? fail(table, row.id, "caseId", `Unknown case ${row.caseId}`);
  };
  for (const row of tables.TbAttribute.getDataList()) {
    game.attributes[row.id] = { initial: row.initial, min: row.min, max: row.max };
    bind("attribute", row.id, ["attributes", row.id]);
  }
  for (const row of tables.TbCase.getDataList()) {
    game.cases[row.id] = {
      id: row.id,
      order: row.order,
      startNodeId: row.startNodeId,
      characters: [],
      nodes: Object.create(null),
      resolutions: Object.create(null),
    };
    bind("case", row.id, ["cases", row.id]);
    if (row.initial) {
      bind("case", row.id, ["initial", "caseIds", game.initial.caseIds.length], "initial");
      game.initial.caseIds.push(row.id);
    }
  }
  for (const row of tables.TbNode.getDataList()) {
    caseFor("node", row).nodes[row.id] = { choices: [] };
    bind("node", row.id, ["cases", row.caseId, "nodes", row.id]);
  }
  for (const row of tables.TbResolution.getDataList()) {
    caseFor("resolution", row).resolutions[row.id] = {
      effects: { attributeDeltas: Object.create(null), setFlags: Object.create(null) },
    };
    bind("resolution", row.id, ["cases", row.caseId, "resolutions", row.id]);
  }
  for (const row of tables.TbChoice.getDataList()) {
    const node =
      caseFor("choice", row).nodes[row.nodeId] ??
      fail("choice", row.id, "nodeId", `Unknown node ${row.nodeId}`);
    const target =
      row.targetKind === TargetKind.Node
        ? { type: "node" as const, nodeId: row.targetId }
        : row.targetKind === TargetKind.Resolution
          ? { type: "resolution" as const, resolutionId: row.targetId }
          : fail("choice", row.id, "targetKind", "Unsupported target kind");
    const runtimePath = ["cases", row.caseId, "nodes", row.nodeId, "choices", node.choices.length];
    bind("choice", row.id, runtimePath);
    bind("choice", row.id, [...runtimePath, "target"], "targetId");
    node.choices.push({ id: row.id, hasAnnotation: row.hasAnnotation, target });
  }
  for (const row of tables.TbEffect.getDataList()) {
    const resolution =
      caseFor("effect", row).resolutions[row.resolutionId] ??
      fail("effect", row.id, "resolutionId", `Unknown resolution ${row.resolutionId}`);
    const key =
      row.kind === EffectKind.AttributeDelta
        ? "attributeDeltas"
        : row.kind === EffectKind.SetFlag
          ? "setFlags"
          : fail("effect", row.id, "kind", "Unsupported effect kind");
    if (Object.hasOwn(resolution.effects[key], row.key))
      fail(
        "effect",
        row.id,
        "key",
        "Duplicate effect key; use one explicit value per resolution/key",
      );
    // Inactive columns must stay neutral rather than silently hiding an author's change.
    if (key === "attributeDeltas") {
      if (row.enabled) fail("effect", row.id, "enabled", "AttributeDelta requires enabled=false");
      resolution.effects.attributeDeltas[row.key] = row.amount;
    } else {
      if (row.amount !== 0) fail("effect", row.id, "amount", "SetFlag requires amount=0");
      resolution.effects.setFlags[row.key] = row.enabled;
    }
    bind(
      "effect",
      row.id,
      ["cases", row.caseId, "resolutions", row.resolutionId, "effects", key, row.key],
      "key",
    );
  }
  return { game, mappings };
}

export function locateIssue(
  issue: ContentValidationIssue,
  mappings: readonly SourceMapping[],
): SourceLocation {
  if (issue.source !== "game.json")
    return { file: issue.source, objectId: issue.objectId, field: issue.path.join(".") };
  const match = [...mappings]
    .sort((a, b) => b.path.length - a.path.length)
    .find((entry) => entry.path.every((part, i) => issue.path[i] === part));
  if (!match) return { file: issue.source, objectId: issue.objectId, field: issue.path.join(".") };
  const suffix = issue.path.slice(match.path.length).join(".");
  return {
    ...match.location,
    objectId: match.path.length === 0 ? issue.objectId : match.location.objectId,
    field:
      ["id", "<root>"].includes(match.location.field) && suffix ? suffix : match.location.field,
  };
}
