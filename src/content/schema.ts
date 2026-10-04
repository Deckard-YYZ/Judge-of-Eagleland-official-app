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
export const SUPPORTED_CONTENT_SCHEMA_VERSION = 6;

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
    contentSchemaVersion: z.union([
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(SUPPORTED_CONTENT_SCHEMA_VERSION),
    ]),
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

export const GameCharacterDefinitionSchema = z.strictObject({
  id: IdSchema,
  portraitAssetId: IdSchema.optional(),
});
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

/** Logical voice identifiers deliberately contain no provider or model configuration. */
export const NarrationDefinitionSchema = z.strictObject({
  voiceId: z.literal("system"),
  textSource: z.enum(["blocks", "narrationText"]),
});
export type NarrationDefinition = z.infer<typeof NarrationDefinitionSchema>;
export type NarrationVoiceId = NarrationDefinition["voiceId"];

export const ActionInputStepSchema = z.strictObject({
  id: IdSchema,
  type: z.literal("actionInput"),
  targetActionId: z.enum(ACTION_IDS),
  wrongEffects: GameEffectsSchema.optional(),
  narration: NarrationDefinitionSchema.optional(),
});
export type ActionInputStep = z.infer<typeof ActionInputStepSchema>;

export const GameStoryStepSchema = z.discriminatedUnion("type", [
  ActionInputStepSchema,
  z.strictObject({
    id: IdSchema,
    type: z.literal("text"),
    narration: NarrationDefinitionSchema.optional(),
  }),
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

/** Finite business events are derived from successful case transitions, never UI timers. */
export const CaseEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("caseStarted"), caseId: IdSchema }),
  z.strictObject({
    type: z.literal("choiceCompleted"),
    caseId: IdSchema,
    nodeId: IdSchema,
    choiceId: IdSchema,
  }),
  z.strictObject({
    type: z.literal("caseResolved"),
    caseId: IdSchema,
    resolutionId: IdSchema,
  }),
]);
export type CaseEvent = z.infer<typeof CaseEventSchema>;

/** Stage/chat rules read supplied facts; this contract does not auto-advance Session. */
export const FlowPredicateSchema = z.discriminatedUnion("type", [
  ...PredicateSchema.options,
  z.strictObject({ type: z.literal("currentStage"), stageId: IdSchema }),
  z.strictObject({ type: z.literal("chatLastNode"), chatId: IdSchema, nodeId: IdSchema }),
]);
export type FlowPredicate = z.infer<typeof FlowPredicateSchema>;
export const FlowConditionSchema = z.union([
  z.strictObject({ all: z.array(FlowPredicateSchema).min(1) }),
  z.strictObject({ any: z.array(FlowPredicateSchema).min(1) }),
]);
export type FlowCondition = z.infer<typeof FlowConditionSchema>;
export const FlowConsequenceSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("unlockCases"), caseIds: z.array(IdSchema).min(1) }),
  z.strictObject({ type: z.literal("unlockChats"), chatIds: z.array(IdSchema).min(1) }),
  z.strictObject({ type: z.literal("enterStage"), stageId: IdSchema }),
]);
export type FlowConsequence = z.infer<typeof FlowConsequenceSchema>;
export const ChatTargetSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("node"), nodeId: IdSchema }),
  z.strictObject({ type: z.literal("event"), eventId: IdSchema }),
]);
export type ChatTarget = z.infer<typeof ChatTargetSchema>;
export const FlowConfigurationSchema = z.strictObject({
  initialStageId: IdSchema,
  stages: z.record(
    IdSchema,
    z.strictObject({
      when: FlowConditionSchema,
      transitions: z.array(
        z.strictObject({ id: IdSchema, when: FlowConditionSchema, targetStageId: IdSchema }),
      ),
    }),
  ),
  chats: z.record(
    IdSchema,
    z.strictObject({
      characterId: IdSchema,
      when: FlowConditionSchema,
      startNodeId: IdSchema,
      nodes: z.record(
        IdSchema,
        z.discriminatedUnion("type", [
          z.strictObject({
            type: z.literal("message"),
            externalBranches: z
              .array(
                z.strictObject({
                  id: IdSchema,
                  event: CaseEventSchema,
                  when: FlowConditionSchema,
                  targetNodeId: IdSchema,
                  consequences: z.array(FlowConsequenceSchema),
                }),
              )
              .optional(),
            replies: z
              .array(
                z.strictObject({
                  id: IdSchema,
                  when: FlowConditionSchema,
                  target: ChatTargetSchema,
                }),
              )
              .min(1),
          }),
          z.strictObject({
            type: z.literal("terminal"),
            consequences: z.array(FlowConsequenceSchema),
          }),
        ]),
      ),
    }),
  ),
  events: z.record(
    IdSchema,
    z.strictObject({
      when: FlowConditionSchema,
      consequences: z.array(FlowConsequenceSchema).min(1),
    }),
  ),
});
export type FlowConfiguration = z.infer<typeof FlowConfigurationSchema>;
export const FlowFactsSchema = z.strictObject({
  currentStageId: IdSchema,
  lastChatNodeIds: z.record(IdSchema, IdSchema),
  activeChatNodeIds: z.record(IdSchema, IdSchema).optional(),
});
export type FlowFacts = z.infer<typeof FlowFactsSchema>;

export const GameConfigurationSchema = z.strictObject({
  flow: FlowConfigurationSchema.optional(),
  interactionOnly: z.strictObject({ attributeIds: z.array(IdSchema), flagIds: z.array(IdSchema) }),
  instructions: z.record(
    IdSchema,
    z.strictObject({
      caseId: IdSchema,
      nodeId: IdSchema,
      choiceId: IdSchema,
      delayMs: IntegerSchema.min(1000).max(2000),
    }),
  ),
  actionInputHooks: z.array(
    z.strictObject({ id: IdSchema, event: CaseEventSchema, storyId: IdSchema }),
  ),
  casePools: z.record(
    IdSchema,
    z.strictObject({
      members: z.array(z.strictObject({ caseId: IdSchema, when: ConditionSchema })).min(1),
    }),
  ),
  dispatchRules: z.array(
    z.strictObject({
      id: IdSchema,
      event: CaseEventSchema,
      when: ConditionSchema,
      poolId: IdSchema,
      strategy: z.strictObject({ type: z.literal("ordered"), caseIds: z.array(IdSchema).min(1) }),
    }),
  ),
});
export type GameConfiguration = z.infer<typeof GameConfigurationSchema>;

/** Main-flow predicates deliberately cannot inspect an active chat's local node. */
export const MainFlowPredicateSchema = z.discriminatedUnion("type", [
  ...PredicateSchema.options,
  z.strictObject({ type: z.literal("mainNode"), nodeId: IdSchema }),
  z.strictObject({ type: z.literal("chatResult"), instanceId: IdSchema, resultId: IdSchema }),
]);
export const MainFlowConditionSchema = z.union([
  z.strictObject({ all: z.array(MainFlowPredicateSchema).min(1) }),
  z.strictObject({ any: z.array(MainFlowPredicateSchema).min(1) }),
]);
export type MainFlowCondition = z.infer<typeof MainFlowConditionSchema>;
export const MainFlowIntentSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("openPool"), poolId: IdSchema }),
  z.strictObject({ type: z.literal("dispatchCase"), caseId: IdSchema }),
  z.strictObject({
    type: z.literal("dispatchPool"),
    poolId: IdSchema,
    strategy: z.strictObject({ type: z.literal("ordered"), caseIds: z.array(IdSchema).min(1) }),
  }),
  z.strictObject({ type: z.literal("startChat"), instanceId: IdSchema, chatId: IdSchema }),
  z.strictObject({ type: z.literal("publishNews"), newsId: IdSchema }),
]);
export const MainFlowDefinitionSchema = z.strictObject({
  initialNodeId: IdSchema,
  tutorialStoryId: IdSchema.optional(),
  nodes: z.record(
    IdSchema,
    z.strictObject({
      stageId: IdSchema,
      onEnter: z.array(MainFlowIntentSchema),
      transitions: z.array(
        z.strictObject({ id: IdSchema, when: MainFlowConditionSchema, targetNodeId: IdSchema }),
      ),
    }),
  ),
  chats: z.record(
    IdSchema,
    z.strictObject({
      characterId: IdSchema,
      startNodeId: IdSchema,
      nodes: z.record(
        IdSchema,
        z.discriminatedUnion("type", [
          z.strictObject({
            type: z.literal("message"),
            replies: z.array(z.strictObject({ id: IdSchema, targetNodeId: IdSchema })).min(1),
          }),
          z.strictObject({ type: z.literal("terminal"), resultId: IdSchema }),
        ]),
      ),
      inactivity: z
        .strictObject({ choiceThreshold: IntegerSchema.positive(), resultId: IdSchema })
        .optional(),
    }),
  ),
  casePools: z.record(
    IdSchema,
    z.strictObject({
      members: z.array(z.strictObject({ caseId: IdSchema, when: MainFlowConditionSchema })).min(1),
    }),
  ),
  news: z.record(IdSchema, z.strictObject({ actionStoryId: IdSchema.optional() })),
});
export type MainFlowDefinition = z.infer<typeof MainFlowDefinitionSchema>;

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
    configuration: GameConfigurationSchema.optional(),
    mainFlow: MainFlowDefinitionSchema.optional(),
  })
  .superRefine((content, context) => {
    if (content.manifest.contentSchemaVersion < 5)
      for (const [caseId, definition] of Object.entries(content.cases))
        definition.characters.forEach((character, index) => {
          if (character.portraitAssetId !== undefined)
            context.addIssue({
              code: "custom",
              path: ["cases", caseId, "characters", index, "portraitAssetId"],
              message: "Character portraits require content schema v5.",
            });
        });
    if (content.manifest.contentSchemaVersion >= 5 !== (content.configuration !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["configuration"],
        message: "configuration is required exclusively by content schema v5 and v6.",
      });
    }
    if ((content.manifest.contentSchemaVersion === 6) !== (content.mainFlow !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["mainFlow"],
        message: "mainFlow is required exclusively by content schema v6.",
      });
    }
    if (content.mainFlow && content.configuration?.flow) {
      context.addIssue({
        code: "custom",
        path: ["configuration", "flow"],
        message: "Legacy flow cannot be combined with mainFlow.",
      });
    }
    if (content.manifest.contentSchemaVersion < 4) {
      for (const [storyId, story] of Object.entries(content.stories)) {
        story.steps.forEach((step, index) => {
          if (
            (step.type === "text" || step.type === "actionInput") &&
            step.narration !== undefined
          ) {
            context.addIssue({
              code: "custom",
              path: ["stories", storyId, "steps", index, "narration"],
              message: "narration requires content schema v4.",
            });
          }
        });
      }
    }
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
  narrationText: z.string().optional(),
});

export const LocalizedStorySchema = z.strictObject({
  title: TextSchema,
  steps: z.record(IdSchema, LocalizedStoryStepSchema),
});

export const LocalizedContentCatalogSchema = z.strictObject({
  mainFlow: z
    .strictObject({
      chats: z.record(
        IdSchema,
        z.strictObject({
          title: TextSchema,
          nodes: z.record(
            IdSchema,
            z.strictObject({
              blocks: z.array(TextBlockSchema).min(1),
              replies: z.record(IdSchema, TextSchema),
            }),
          ),
        }),
      ),
      news: z.record(
        IdSchema,
        z.strictObject({ title: TextSchema, blocks: z.array(TextBlockSchema).min(1) }),
      ),
    })
    .optional(),
  flow: z
    .strictObject({
      stages: z.record(
        IdSchema,
        z.strictObject({ title: TextSchema, blocks: z.array(TextBlockSchema).min(1) }),
      ),
      chats: z.record(
        IdSchema,
        z.strictObject({
          title: TextSchema,
          nodes: z.record(
            IdSchema,
            z.strictObject({
              blocks: z.array(TextBlockSchema).min(1),
              replies: z.record(IdSchema, z.strictObject({ text: TextSchema })),
            }),
          ),
        }),
      ),
    })
    .optional(),
  packageId: IdSchema,
  version: IdSchema,
  locale: AppLocaleSchema,
  manifest: z.strictObject({ title: TextSchema }),
  attributes: z.record(IdSchema, z.strictObject({ label: TextSchema })),
  cases: z.record(IdSchema, LocalizedCaseSchema),
  stories: z.record(IdSchema, LocalizedStorySchema),
  endings: z.record(IdSchema, z.strictObject({ title: TextSchema })),
  instructions: z
    .record(IdSchema, z.strictObject({ blocks: z.array(TextBlockSchema).min(1) }))
    .optional(),
});

export type LocalizedContentCatalog = z.infer<typeof LocalizedContentCatalogSchema>;
export type ContentLocale = AppLocale;
