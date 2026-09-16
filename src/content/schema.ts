import { z } from "zod";
import { ACTION_IDS } from "../shared/action";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../shared/locale";
import type { AppLocale } from "../shared/locale";

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
export const SUPPORTED_CONTENT_SCHEMA_VERSION = 3;

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

export const GameEffectsSchema = z.strictObject({
  attributeDeltas: z.record(IdSchema, IntegerSchema),
  setFlags: z.record(IdSchema, z.boolean()),
});

export type GameEffects = z.infer<typeof GameEffectsSchema>;
export const ResolutionEffectsSchema = GameEffectsSchema;

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

export const AssetDefinitionSchema = z.strictObject({
  kind: z.enum(["image", "video", "audio"]),
  path: TextSchema,
});

export type AssetDefinition = z.infer<typeof AssetDefinitionSchema>;

const AppLocaleSchema = z.enum(SUPPORTED_LOCALES);

export const GameContentManifestSchema = z
  .strictObject({
    packageId: IdSchema,
    version: IdSchema,
    contentSchemaVersion: z.union([z.literal(2), z.literal(SUPPORTED_CONTENT_SCHEMA_VERSION)]),
    defaultLocale: AppLocaleSchema.default(DEFAULT_LOCALE),
    supportedLocales: z.array(AppLocaleSchema).min(1),
  })
  .superRefine((manifest, context) => {
    if (new Set(manifest.supportedLocales).size !== manifest.supportedLocales.length) {
      context.addIssue({
        code: "custom",
        path: ["supportedLocales"],
        message: "locales must be unique",
      });
    }
    if (!manifest.supportedLocales.includes(manifest.defaultLocale)) {
      context.addIssue({
        code: "custom",
        path: ["defaultLocale"],
        message: "defaultLocale must be listed in supportedLocales",
      });
    }
  });

export type GameContentManifest = z.infer<typeof GameContentManifestSchema>;

export const GameAttributeDefinitionSchema = z
  .strictObject({
    initial: IntegerSchema,
    min: IntegerSchema,
    max: IntegerSchema,
  })
  .superRefine((attribute, context) => {
    if (attribute.min > attribute.max) {
      context.addIssue({ code: "custom", path: ["max"], message: "max must be >= min" });
    }
    if (attribute.initial < attribute.min || attribute.initial > attribute.max) {
      context.addIssue({ code: "custom", path: ["initial"], message: "initial must be in range" });
    }
  });

export const GameCharacterDefinitionSchema = z.strictObject({ id: IdSchema });
export type GameCharacterDefinition = z.infer<typeof GameCharacterDefinitionSchema>;

export const GameChoiceDefinitionSchema = z.strictObject({
  id: IdSchema,
  hasAnnotation: z.boolean(),
  target: ChoiceTargetSchema,
});
export type GameChoiceDefinition = z.infer<typeof GameChoiceDefinitionSchema>;

export const GameDecisionNodeSchema = z.strictObject({
  choices: z.array(GameChoiceDefinitionSchema).min(1),
});
export type GameDecisionNode = z.infer<typeof GameDecisionNodeSchema>;

export const GameResolutionDefinitionSchema = z.strictObject({
  effects: ResolutionEffectsSchema,
});
export type GameResolutionDefinition = z.infer<typeof GameResolutionDefinitionSchema>;

export const GameCaseDefinitionSchema = z.strictObject({
  id: IdSchema,
  order: IntegerSchema,
  characters: z.array(GameCharacterDefinitionSchema),
  startNodeId: IdSchema,
  nodes: z.record(IdSchema, GameDecisionNodeSchema),
  resolutions: z.record(IdSchema, GameResolutionDefinitionSchema),
});
export type GameCaseDefinition = z.infer<typeof GameCaseDefinitionSchema>;

export const ActionInputStepSchema = z.strictObject({
  id: IdSchema,
  type: z.literal("actionInput"),
  targetActionId: z.enum(ACTION_IDS),
  wrongEffects: GameEffectsSchema.optional(),
});
export type ActionInputStep = z.infer<typeof ActionInputStepSchema>;

export const GameStoryStepSchema = z.discriminatedUnion("type", [
  ActionInputStepSchema,
  z.strictObject({ id: IdSchema, type: z.literal("text") }),
  z.strictObject({ id: IdSchema, type: z.literal("video"), assetId: IdSchema }),
  z.strictObject({
    id: IdSchema,
    type: z.literal("effect"),
    effect: z.enum(["blood", "fade"]),
    durationMs: IntegerSchema.positive(),
  }),
]);
export type GameStoryStep = z.infer<typeof GameStoryStepSchema>;

export const GameStoryDefinitionSchema = z.strictObject({
  skippable: z.boolean(),
  steps: z.array(GameStoryStepSchema).min(1),
});
export type GameStoryDefinition = z.infer<typeof GameStoryDefinitionSchema>;

export const GameEndingDefinitionSchema = z.strictObject({
  priority: IntegerSchema,
  when: ConditionSchema,
  storyId: IdSchema,
});
export type GameEndingDefinition = z.infer<typeof GameEndingDefinitionSchema>;

export const GameContentCatalogSchema = z
  .strictObject({
    manifest: GameContentManifestSchema,
    attributes: z.record(IdSchema, GameAttributeDefinitionSchema),
    initial: InitialGameDefinitionSchema,
    cases: z.record(IdSchema, GameCaseDefinitionSchema),
    unlockRules: z.array(UnlockRuleSchema),
    storyRules: z.array(StoryRuleSchema),
    stories: z.record(IdSchema, GameStoryDefinitionSchema),
    endings: z.record(IdSchema, GameEndingDefinitionSchema),
    assets: z.record(IdSchema, AssetDefinitionSchema),
  })
  .superRefine((content, context) => {
    if (content.manifest.contentSchemaVersion === 2) {
      for (const [storyId, story] of Object.entries(content.stories)) {
        story.steps.forEach((step, index) => {
          if (step.type === "actionInput")
            context.addIssue({
              code: "custom",
              path: ["stories", storyId, "steps", index],
              message: "actionInput requires content schema v3.",
            });
        });
      }
    }
  });

export type GameContentCatalog = z.infer<typeof GameContentCatalogSchema>;

export const LocalizedCharacterSchema = z.strictObject({
  name: TextSchema,
  description: z.array(TextBlockSchema),
});

export const LocalizedChoiceSchema = z.strictObject({
  text: TextSchema,
  annotation: ChoiceAnnotationSchema.optional(),
});

export const LocalizedNodeSchema = z.strictObject({ prompt: TextSchema });

export const LocalizedResolutionSchema = z.strictObject({
  verdict: z.array(TextBlockSchema),
  result: z.array(TextBlockSchema),
});

export const LocalizedCaseSchema = z.strictObject({
  title: TextSchema,
  characters: z.record(IdSchema, LocalizedCharacterSchema),
  summary: z.array(TextBlockSchema),
  body: z.array(TextBlockSchema),
  nodes: z.record(IdSchema, LocalizedNodeSchema),
  choices: z.record(IdSchema, LocalizedChoiceSchema),
  resolutions: z.record(IdSchema, LocalizedResolutionSchema),
});

export const LocalizedStoryStepSchema = z.strictObject({
  blocks: z.array(TextBlockSchema).min(1),
});

export const LocalizedStorySchema = z.strictObject({
  title: TextSchema,
  steps: z.record(IdSchema, LocalizedStoryStepSchema),
});

export const LocalizedContentCatalogSchema = z.strictObject({
  packageId: IdSchema,
  version: IdSchema,
  locale: AppLocaleSchema,
  manifest: z.strictObject({ title: TextSchema }),
  attributes: z.record(IdSchema, z.strictObject({ label: TextSchema })),
  cases: z.record(IdSchema, LocalizedCaseSchema),
  stories: z.record(IdSchema, LocalizedStorySchema),
  endings: z.record(IdSchema, z.strictObject({ title: TextSchema })),
});

export type LocalizedContentCatalog = z.infer<typeof LocalizedContentCatalogSchema>;
export type ContentLocale = AppLocale;
