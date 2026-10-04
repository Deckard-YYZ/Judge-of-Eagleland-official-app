import {
  ContentRefSchema,
  CaseEventSchema,
  type AttributeId,
  type CaseId,
  type ChoiceId,
  type EndingId,
  type FlagId,
  type NodeId,
  type ResolutionId,
  type StoryId,
} from "../content/schema";
import { z } from "zod";

const IdSchema = z.string().min(1);
const IntegerSchema = z.number().int().finite();
const IsoDateTimeSchema = z.iso.datetime({ offset: true });

/** 当前支持的存档 Schema 版本。改变存档形状时必须提供迁移路径。 */
export const SUPPORTED_SAVE_SCHEMA_VERSION = 5;

export const ChoiceRecordSchema = z.strictObject({
  nodeId: IdSchema,
  choiceId: IdSchema,
});

export type ChoiceRecord = z.infer<typeof ChoiceRecordSchema>;

export const AttributeChangeSnapshotSchema = z.strictObject({
  attributeId: IdSchema,
  before: IntegerSchema,
  after: IntegerSchema,
  actualDelta: IntegerSchema,
});

export type AttributeChangeSnapshot = z.infer<typeof AttributeChangeSnapshotSchema>;

export const ResolutionSnapshotSchema = z.strictObject({
  attributeChanges: z.array(AttributeChangeSnapshotSchema),
  resolvedAt: IsoDateTimeSchema,
  resolvedOrder: IntegerSchema.positive(),
});

export type ResolutionSnapshot = z.infer<typeof ResolutionSnapshotSchema>;

export const PendingCaseProgressSchema = z.strictObject({
  status: z.literal("pending"),
});

export const ActiveCaseProgressSchema = z.strictObject({
  status: z.literal("active"),
  currentNodeId: IdSchema,
  history: z.array(ChoiceRecordSchema),
});

export const ResolvedCaseProgressSchema = z.strictObject({
  status: z.literal("resolved"),
  history: z.array(ChoiceRecordSchema),
  resolutionId: IdSchema,
  finalChoiceId: IdSchema,
  snapshot: ResolutionSnapshotSchema,
});

export const CaseProgressSchema = z.discriminatedUnion("status", [
  PendingCaseProgressSchema,
  ActiveCaseProgressSchema,
  ResolvedCaseProgressSchema,
]);

export type CaseProgress = z.infer<typeof CaseProgressSchema>;

export const PlayingPhaseSchema = z.strictObject({
  type: z.literal("playing"),
});

export const EndingPhaseSchema = z.strictObject({
  type: z.literal("ending"),
  endingId: IdSchema,
});

export const EndedPhaseSchema = z.strictObject({
  type: z.literal("ended"),
  endingId: IdSchema,
});

export const RunPhaseSchema = z.discriminatedUnion("type", [
  PlayingPhaseSchema,
  EndingPhaseSchema,
  EndedPhaseSchema,
]);

export type RunPhase = z.infer<typeof RunPhaseSchema>;

const uniqueIds = (ids: readonly string[]): boolean => new Set(ids).size === ids.length;

export const refineStoryQueues = (
  state: { pendingStoryIds: string[]; completedStoryIds: string[] },
  context: z.RefinementCtx,
): void => {
  if (!uniqueIds(state.pendingStoryIds))
    context.addIssue({
      code: "custom",
      path: ["pendingStoryIds"],
      message: "pendingStoryIds must not contain duplicates",
    });
  if (!uniqueIds(state.completedStoryIds))
    context.addIssue({
      code: "custom",
      path: ["completedStoryIds"],
      message: "completedStoryIds must not contain duplicates",
    });
  const completed = new Set(state.completedStoryIds);
  if (state.pendingStoryIds.some((id) => completed.has(id)))
    context.addIssue({
      code: "custom",
      path: ["pendingStoryIds"],
      message: "pendingStoryIds and completedStoryIds must not overlap",
    });
};

/** 最近一次输入提交的恢复位置；不是普通内容的实时播放游标。 */
export const StoryCheckpointSchema = z.strictObject({
  storyId: IdSchema,
  resumeStepId: IdSchema,
});
export type StoryCheckpoint = z.infer<typeof StoryCheckpointSchema>;

export const DispatchFactSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("none") }),
  z.strictObject({ status: z.literal("dispatched"), ruleId: IdSchema, caseId: IdSchema }),
  z.strictObject({
    status: z.literal("needsDecision"),
    reason: z.enum(["ruleConflict", "emptyPool"]),
    ruleIds: z.array(IdSchema).min(1),
    candidateCaseIds: z.array(IdSchema),
  }),
]);
export type DispatchFact = z.infer<typeof DispatchFactSchema>;
export const ConfigurationFactSchema = z.strictObject({
  eventId: IdSchema,
  event: CaseEventSchema,
  hookIds: z.array(IdSchema),
  dispatch: DispatchFactSchema,
});
export type ConfigurationFact = z.infer<typeof ConfigurationFactSchema>;

export const MainFlowStateSchema = z.strictObject({
  currentNodeId: IdSchema,
  enteredNodeIds: z.array(IdSchema),
  openPoolIds: z.array(IdSchema),
  chats: z.record(
    IdSchema,
    z.strictObject({
      chatId: IdSchema,
      currentNodeId: IdSchema,
      history: z.array(z.strictObject({ nodeId: IdSchema, replyId: IdSchema })),
      inactivityChoices: IntegerSchema.nonnegative(),
    }),
  ),
  chatResults: z.record(
    IdSchema,
    z.strictObject({
      chatId: IdSchema,
      resultId: IdSchema,
      terminalNodeId: IdSchema.nullable(),
      reason: z.enum(["normal", "inactivity"]),
    }),
  ),
  publishedNewsIds: z.array(IdSchema),
  readNewsIds: z.array(IdSchema),
  dispatches: z.array(z.strictObject({ nodeId: IdSchema, caseId: IdSchema })),
  needsDecision: z
    .strictObject({
      reason: z.enum(["transitionConflict", "emptyPool"]),
      nodeId: IdSchema,
      candidateIds: z.array(IdSchema),
    })
    .nullable(),
});
export type MainFlowState = z.infer<typeof MainFlowStateSchema>;

/**
 * 一局运行时的唯一业务状态。Schema 只负责可序列化结构和局部不变量；
 * 内容引用图（案件、节点和剧情是否存在）由绑定内容包的校验阶段负责。
 */
export const GameStateSchema = z
  .strictObject({
    phase: RunPhaseSchema,
    attributes: z.record(IdSchema, IntegerSchema),
    flags: z.record(IdSchema, z.boolean()),
    cases: z.record(IdSchema, CaseProgressSchema),
    storyCheckpoint: StoryCheckpointSchema.nullable(),
    pendingStoryIds: z.array(IdSchema),
    completedStoryIds: z.array(IdSchema),
    // Legacy catalogs have no configuration ledger; schema-v5 runs require it in invariants.
    configurationFacts: z.array(ConfigurationFactSchema).optional(),
    mainFlow: MainFlowStateSchema.optional(),
  })
  .superRefine(refineStoryQueues);

export type GameState = z.infer<typeof GameStateSchema>;

export const SaveEnvelopeSchema = z.strictObject({
  saveId: IdSchema,
  profileId: IdSchema,
  revision: IntegerSchema.nonnegative(),
  saveSchemaVersion: z.literal(SUPPORTED_SAVE_SCHEMA_VERSION),
  contentRef: ContentRefSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  state: GameStateSchema,
});

export type SaveEnvelope = z.infer<typeof SaveEnvelopeSchema>;

// These aliases keep the public model vocabulary discoverable to callers that use it as a type API.
export type { AttributeId, CaseId, ChoiceId, EndingId, FlagId, NodeId, ResolutionId, StoryId };
