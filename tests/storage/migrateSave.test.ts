import { describe, expect, it } from "vitest";
import { SaveEnvelopeSchema } from "../../src/game/model";
import { InMemorySaveRepository } from "../../src/storage/inMemorySaveRepository";
import { migrateStoredSaveEnvelope, SaveMigrationError } from "../../src/storage/migrateSave";
import { parseSaveEnvelopeForStorage } from "../../src/storage/saveRepository";

const legacySave = () => ({
  saveId: "legacy-save",
  profileId: "profile-1",
  revision: 7,
  saveSchemaVersion: 1,
  contentRef: { packageId: "minimal-test-package", version: "1.0.0" },
  createdAt: "2026-09-14T10:00:00.000Z",
  updatedAt: "2026-09-15T10:00:00.000Z",
  state: {
    phase: { type: "playing" },
    attributes: { restraint: 53, authority: 48 },
    flags: { first_case_closed: true, second_case_reviewed: false },
    cases: {
      case_001: {
        status: "resolved",
        history: [
          { nodeId: "assessment", choiceId: "confirm_violation" },
          { nodeId: "disposition", choiceId: "formal_warning" },
        ],
        resolutionId: "warning",
        snapshot: {
          caseTitle: "旧语言案件标题",
          finalChoiceText: "旧语言选项",
          verdict: [{ type: "paragraph", text: "旧语言裁定" }],
          result: [{ type: "paragraph", text: "旧语言结果" }],
          attributeChanges: [
            {
              attributeId: "restraint",
              label: "旧语言属性",
              before: 50,
              after: 53,
              actualDelta: 3,
            },
          ],
          resolvedAt: "2026-09-15T09:00:00.000Z",
          resolvedOrder: 1,
        },
      },
      case_002: { status: "pending" },
    },
    pendingStoryIds: [],
    completedStoryIds: ["story_after_case_001"],
  },
});

describe("legacy save to v3 migration", () => {
  it("preserves facts while discarding every localized snapshot field", () => {
    const migrated = migrateStoredSaveEnvelope(legacySave());
    expect(migrated).toMatchObject({
      saveSchemaVersion: 3,
      revision: 7,
      contentRef: { packageId: "minimal-test-package", version: "1.0.0" },
      state: {
        attributes: { restraint: 53, authority: 48 },
        cases: {
          case_001: {
            status: "resolved",
            resolutionId: "warning",
            finalChoiceId: "formal_warning",
            snapshot: {
              resolvedAt: "2026-09-15T09:00:00.000Z",
              resolvedOrder: 1,
              attributeChanges: [
                {
                  attributeId: "restraint",
                  before: 50,
                  after: 53,
                  actualDelta: 3,
                },
              ],
            },
          },
        },
      },
    });
    const json = JSON.stringify(migrated);
    expect(json).not.toMatch(/旧语言|caseTitle|finalChoiceText|verdict|result|"label"|"locale"/u);
    expect(SaveEnvelopeSchema.parse(migrated)).toEqual(migrated);
  });

  it("is idempotent and migrates only at the repository read boundary", async () => {
    const once = migrateStoredSaveEnvelope(legacySave());
    expect(migrateStoredSaveEnvelope(once)).toEqual(once);
    const repository = new InMemorySaveRepository([legacySave()]);
    await expect(repository.load("legacy-save", "profile-1")).resolves.toEqual(once);
    expect(() => parseSaveEnvelopeForStorage(legacySave())).toThrowError(
      expect.objectContaining({ code: "INVALID_SAVE" }),
    );
  });

  it("returns a stable migration diagnostic when a resolved v1 case lacks final history", () => {
    const invalid = legacySave();
    invalid.state.cases.case_001.history = [];
    expect(() => migrateStoredSaveEnvelope(invalid)).toThrowError(
      expect.objectContaining<Partial<SaveMigrationError>>({
        code: "SAVE_MIGRATION_FAILED",
        path: ["state", "cases", "case_001", "history"],
      }),
    );
  });
});
