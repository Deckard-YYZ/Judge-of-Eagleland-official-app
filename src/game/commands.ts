import { z } from "zod";
import {
  AttributeChangeSnapshotSchema,
  GameStateSchema,
  type AttributeChangeSnapshot,
  type GameState,
} from "./model";
import type { CaseId, ChoiceId, ContentCatalog, NodeId, StoryId } from "../content/schema";

const IdSchema = z.string().min(1);

/**
 * 所有玩家操作从这里进入规则层。命令只携带稳定 ID，不携带 UI 或存储对象。
 */
export const GameCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("startCase"),
    caseId: IdSchema,
  }),
  z.strictObject({
    type: z.literal("chooseOption"),
    caseId: IdSchema,
    nodeId: IdSchema,
    choiceId: IdSchema,
  }),
  z.strictObject({
    type: z.literal("completeStory"),
    storyId: IdSchema,
  }),
]);

export type GameCommand = z.infer<typeof GameCommandSchema>;

export const FeedbackRequestSchema = z.strictObject({
  type: z.literal("attributeFeedback"),
  caseId: IdSchema,
  changes: z.array(AttributeChangeSnapshotSchema),
});

export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

export const TransitionErrorCodeSchema = z.enum([
  "CASE_LOCKED",
  "CASE_ALREADY_RESOLVED",
  "CASE_ALREADY_STARTED",
  "STALE_CHOICE",
  "INVALID_CHOICE",
  "STORY_BLOCKING",
  "INVALID_STORY_COMPLETION",
  "RUN_FINISHED",
  "CONTENT_INVALID",
]);

export type TransitionErrorCode = z.infer<typeof TransitionErrorCodeSchema>;

export const TransitionSuccessSchema = z.strictObject({
  ok: z.literal(true),
  nextState: GameStateSchema,
  feedback: z.array(FeedbackRequestSchema),
});

export const TransitionFailureSchema = z.strictObject({
  ok: z.literal(false),
  code: TransitionErrorCodeSchema,
  message: z.string().min(1),
});

export const TransitionResultSchema = z.discriminatedUnion("ok", [
  TransitionSuccessSchema,
  TransitionFailureSchema,
]);

export type TransitionResult = z.infer<typeof TransitionResultSchema>;

export const TransitionContextSchema = z.strictObject({
  nowIso: z.iso.datetime({ offset: true }),
});

export type TransitionContext = z.infer<typeof TransitionContextSchema>;

/** 正式同步纯规则入口的公共签名；实现不得读写存储、系统时间或 UI 状态。 */
export type Transition = (
  state: Readonly<GameState>,
  command: GameCommand,
  content: Readonly<ContentCatalog>,
  context: TransitionContext,
) => TransitionResult;

// Keep the imported aliases visible to declaration consumers without introducing runtime dependencies.
export type { AttributeChangeSnapshot, CaseId, ChoiceId, NodeId, StoryId };
