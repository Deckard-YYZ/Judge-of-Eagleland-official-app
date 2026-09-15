import { z } from "zod";

/**
 * 内容包中的稳定标识都使用字符串，并由内容包负责保证其唯一性。
 * 交叉引用（例如 choice target 指向的 node 是否存在）属于后续内容校验器的职责。
 */
const IdSchema = z.string().min(1);
const TextSchema = z.string().min(1);
const IntegerSchema = z.number().int().finite();

// 稳定 ID 的别名保持文档契约可读；它们都由同一个非空字符串 Schema 推导。
export type CaseId = z.infer<typeof IdSchema>;
export type NodeId = z.infer<typeof IdSchema>;
export type ChoiceId = z.infer<typeof IdSchema>;
export type ResolutionId = z.infer<typeof IdSchema>;
export type AttributeId = z.infer<typeof IdSchema>;
export type FlagId = z.infer<typeof IdSchema>;
export type StoryId = z.infer<typeof IdSchema>;
export type EndingId = z.infer<typeof IdSchema>;
export type AssetId = z.infer<typeof IdSchema>;

/** 当前骨架支持的内容 Schema 版本。升级时需显式增加迁移或兼容策略。 */
export const SUPPORTED_CONTENT_SCHEMA_VERSION = 1;

export const TextBlockSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("paragraph"),
    text: TextSchema,
  }),
  z.strictObject({
    type: z.literal("heading"),
    text: TextSchema,
  }),
  z.strictObject({
    type: z.literal("quote"),
    text: TextSchema,
  }),
]);

export type TextBlock = z.infer<typeof TextBlockSchema>;

export const ContentRefSchema = z.strictObject({
  packageId: IdSchema,
  version: IdSchema,
});

export type ContentRef = z.infer<typeof ContentRefSchema>;

export const ContentManifestSchema = z.strictObject({
  packageId: IdSchema,
  version: IdSchema,
  contentSchemaVersion: z.literal(SUPPORTED_CONTENT_SCHEMA_VERSION),
  title: TextSchema,
});

export type ContentManifest = z.infer<typeof ContentManifestSchema>;

export const CharacterBriefSchema = z.strictObject({
  id: IdSchema,
  name: TextSchema,
  description: z.array(TextBlockSchema),
});

export type CharacterBrief = z.infer<typeof CharacterBriefSchema>;

export const ChoiceAnnotationSchema = z.strictObject({
  title: TextSchema.optional(),
  body: z.array(TextBlockSchema),
});

export type ChoiceAnnotation = z.infer<typeof ChoiceAnnotationSchema>;

export const ChoiceTargetSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("node"),
    nodeId: IdSchema,
  }),
  z.strictObject({
    type: z.literal("resolution"),
    resolutionId: IdSchema,
  }),
]);

export type ChoiceTarget = z.infer<typeof ChoiceTargetSchema>;

export const ChoiceDefinitionSchema = z.strictObject({
  id: IdSchema,
  text: TextSchema,
  annotation: ChoiceAnnotationSchema.optional(),
  target: ChoiceTargetSchema,
});

export type ChoiceDefinition = z.infer<typeof ChoiceDefinitionSchema>;

export const DecisionNodeSchema = z.strictObject({
  prompt: TextSchema.optional(),
  choices: z.array(ChoiceDefinitionSchema).min(1),
});

export type DecisionNode = z.infer<typeof DecisionNodeSchema>;

export const ResolutionDefinitionSchema = z.strictObject({
  verdict: z.array(TextBlockSchema),
  result: z.array(TextBlockSchema),
  effects: z.strictObject({
    attributeDeltas: z.record(IdSchema, IntegerSchema),
    setFlags: z.record(IdSchema, z.boolean()),
  }),
});

export type ResolutionDefinition = z.infer<typeof ResolutionDefinitionSchema>;

export const CaseDefinitionSchema = z.strictObject({
  id: IdSchema,
  title: TextSchema,
  order: IntegerSchema,
  characters: z.array(CharacterBriefSchema),
  summary: z.array(TextBlockSchema),
  body: z.array(TextBlockSchema),
  startNodeId: IdSchema,
  nodes: z.record(IdSchema, DecisionNodeSchema),
  resolutions: z.record(IdSchema, ResolutionDefinitionSchema),
});

export type CaseDefinition = z.infer<typeof CaseDefinitionSchema>;

export const AttributeDefinitionSchema = z
  .strictObject({
    label: TextSchema,
    initial: IntegerSchema,
    min: IntegerSchema,
    max: IntegerSchema,
  })
  .superRefine((attribute, context) => {
    if (attribute.min > attribute.max) {
      context.addIssue({
        code: "custom",
        path: ["max"],
        message: "max must be greater than or equal to min",
      });
    }

    if (attribute.initial < attribute.min || attribute.initial > attribute.max) {
      context.addIssue({
        code: "custom",
        path: ["initial"],
        message: "initial must be within the configured range",
      });
    }
  });

export type AttributeDefinition = z.infer<typeof AttributeDefinitionSchema>;

export const InitialGameDefinitionSchema = z.strictObject({
  caseIds: z.array(IdSchema),
  storyIds: z.array(IdSchema),
  flags: z.record(IdSchema, z.boolean()),
});

export type InitialGameDefinition = z.infer<typeof InitialGameDefinitionSchema>;

export const PredicateSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("caseResolved"),
    caseId: IdSchema,
    resolutionId: IdSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("resolvedCountAtLeast"),
    count: IntegerSchema.nonnegative(),
  }),
  z.strictObject({
    type: z.literal("attributeAtLeast"),
    attributeId: IdSchema,
    value: IntegerSchema,
  }),
  z.strictObject({
    type: z.literal("attributeAtMost"),
    attributeId: IdSchema,
    value: IntegerSchema,
  }),
  z.strictObject({
    type: z.literal("flagEquals"),
    flagId: IdSchema,
    value: z.boolean(),
  }),
]);

export type Predicate = z.infer<typeof PredicateSchema>;

export const ConditionSchema = z.strictObject({
  all: z.array(PredicateSchema).min(1),
});

export type Condition = z.infer<typeof ConditionSchema>;

export const UnlockRuleSchema = z.strictObject({
  id: IdSchema,
  when: ConditionSchema,
  caseIds: z.array(IdSchema),
});

export type UnlockRule = z.infer<typeof UnlockRuleSchema>;

export const StoryRuleSchema = z.strictObject({
  id: IdSchema,
  when: ConditionSchema,
  storyId: IdSchema,
  order: IntegerSchema,
});

export type StoryRule = z.infer<typeof StoryRuleSchema>;

export const EndingDefinitionSchema = z.strictObject({
  title: TextSchema,
  priority: IntegerSchema,
  when: ConditionSchema,
  storyId: IdSchema,
});

export type EndingDefinition = z.infer<typeof EndingDefinitionSchema>;

export const StoryStepSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("text"),
    blocks: z.array(TextBlockSchema),
  }),
  z.strictObject({
    type: z.literal("video"),
    assetId: IdSchema,
    fallbackBlocks: z.array(TextBlockSchema).min(1),
  }),
  z.strictObject({
    type: z.literal("effect"),
    effect: z.enum(["blood", "fade"]),
    durationMs: IntegerSchema.positive(),
  }),
]);

export type StoryStep = z.infer<typeof StoryStepSchema>;

export const StoryDefinitionSchema = z.strictObject({
  title: TextSchema,
  skippable: z.boolean(),
  steps: z.array(StoryStepSchema).min(1),
});

export type StoryDefinition = z.infer<typeof StoryDefinitionSchema>;

export const AssetDefinitionSchema = z.strictObject({
  kind: z.enum(["image", "video", "audio"]),
  path: TextSchema,
});

export type AssetDefinition = z.infer<typeof AssetDefinitionSchema>;

/**
 * 内容目录的唯一结构入口。此 Schema 只检查字段形状与局部值域；
 * 节点、案件、属性和剧情之间的完整引用图校验由后续阶段的 Validator 负责。
 */
export const ContentCatalogSchema = z.strictObject({
  manifest: ContentManifestSchema,
  attributes: z.record(IdSchema, AttributeDefinitionSchema),
  initial: InitialGameDefinitionSchema,
  cases: z.record(IdSchema, CaseDefinitionSchema),
  unlockRules: z.array(UnlockRuleSchema),
  storyRules: z.array(StoryRuleSchema),
  stories: z.record(IdSchema, StoryDefinitionSchema),
  endings: z.record(IdSchema, EndingDefinitionSchema),
  assets: z.record(IdSchema, AssetDefinitionSchema),
});

export type ContentCatalog = z.infer<typeof ContentCatalogSchema>;
