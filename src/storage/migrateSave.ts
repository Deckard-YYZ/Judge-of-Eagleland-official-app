import { z } from "zod";
import { ContentRefSchema, TextBlockSchema } from "../content/schema";
import {
  ActiveCaseProgressSchema,
  GameStateSchema,
  PendingCaseProgressSchema,
  RunPhaseSchema,
  SaveEnvelopeSchema,
  type SaveEnvelope,
} from "../game/model";

const IdSchema = z.string().min(1);
const IntegerSchema = z.number().int().finite();
const IsoDateTimeSchema = z.iso.datetime({ offset: true });

const LegacyAttributeChangeSchema = z.strictObject({
  attributeId: IdSchema,
  label: z.string().min(1),
  before: IntegerSchema,
  after: IntegerSchema,
  actualDelta: IntegerSchema,
});

const LegacyResolutionSnapshotSchema = z.strictObject({
  caseTitle: z.string().min(1),
  finalChoiceText: z.string().min(1),
  verdict: z.array(TextBlockSchema),
  result: z.array(TextBlockSchema),
  attributeChanges: z.array(LegacyAttributeChangeSchema),
  resolvedAt: IsoDateTimeSchema,
  resolvedOrder: IntegerSchema.positive(),
});

const LegacyResolvedCaseProgressSchema = z.strictObject({
  status: z.literal("resolved"),
  history: z.array(z.strictObject({ nodeId: IdSchema, choiceId: IdSchema })),
  resolutionId: IdSchema,
  snapshot: LegacyResolutionSnapshotSchema,
});

const LegacyGameStateSchema = z.strictObject({
  phase: RunPhaseSchema,
  attributes: z.record(IdSchema, IntegerSchema),
  flags: z.record(IdSchema, z.boolean()),
  cases: z.record(
    IdSchema,
    z.discriminatedUnion("status", [
      PendingCaseProgressSchema,
      ActiveCaseProgressSchema,
      LegacyResolvedCaseProgressSchema,
    ]),
  ),
  pendingStoryIds: z.array(IdSchema),
  completedStoryIds: z.array(IdSchema),
});

const LegacySaveEnvelopeSchema = z.strictObject({
  saveId: IdSchema,
  profileId: IdSchema,
  revision: IntegerSchema.nonnegative(),
  saveSchemaVersion: z.literal(1),
  contentRef: ContentRefSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  state: LegacyGameStateSchema,
});

export class SaveMigrationError extends Error {
  readonly code = "SAVE_MIGRATION_FAILED";
  readonly path: readonly (string | number)[];
  readonly cause?: unknown;

  constructor(message: string, path: readonly (string | number)[] = [], cause?: unknown) {
    super(message);
    this.name = "SaveMigrationError";
    this.path = Object.freeze([...path]);
    this.cause = cause;
  }
}

/**
 * Reads persisted v1 or v2 data and always returns the public v2 shape. Legacy
 * localized strings are discarded; saved IDs, deltas, timestamps and order survive.
 */
export function migrateStoredSaveEnvelope(value: unknown): SaveEnvelope {
  const current = SaveEnvelopeSchema.safeParse(value);
  if (current.success) return current.data;

  const legacy = LegacySaveEnvelopeSchema.safeParse(value);
  if (!legacy.success) {
    throw new SaveMigrationError("Stored save is neither a valid v1 nor v2 envelope.", [], {
      v1: legacy.error,
      v2: current.error,
    });
  }

  const cases = Object.fromEntries(
    Object.entries(legacy.data.state.cases).map(([caseId, progress]) => {
      if (progress.status !== "resolved") return [caseId, progress];
      const finalRecord = progress.history.at(-1);
      if (!finalRecord) {
        throw new SaveMigrationError(`Resolved v1 case "${caseId}" has no final history record.`, [
          "state",
          "cases",
          caseId,
          "history",
        ]);
      }
      return [
        caseId,
        {
          status: "resolved" as const,
          history: progress.history,
          resolutionId: progress.resolutionId,
          finalChoiceId: finalRecord.choiceId,
          snapshot: {
            attributeChanges: progress.snapshot.attributeChanges.map(
              ({ attributeId, before, after, actualDelta }) => ({
                attributeId,
                before,
                after,
                actualDelta,
              }),
            ),
            resolvedAt: progress.snapshot.resolvedAt,
            resolvedOrder: progress.snapshot.resolvedOrder,
          },
        },
      ];
    }),
  );

  try {
    return SaveEnvelopeSchema.parse({
      ...legacy.data,
      saveSchemaVersion: 2,
      state: GameStateSchema.parse({ ...legacy.data.state, cases }),
    });
  } catch (error) {
    throw new SaveMigrationError(
      "The migrated v1 save does not satisfy the v2 contract.",
      [],
      error,
    );
  }
}
