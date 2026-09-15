import { z } from "zod";

import {
  SaveRepositoryError,
  parseGameStateForStorage,
  parseSaveEnvelopeForStorage,
  parseStoredSaveEnvelope,
  type SaveCommitInput,
  type SaveCommitResult,
  type SaveRepository,
} from "./saveRepository";
import type { SqlDatabase } from "./schema";
import type { GameState, SaveEnvelope } from "../game/model";

const IsoDateTimeSchema = z.iso.datetime({ offset: true });

interface SaveRow extends Record<string, unknown> {
  save_id: string;
  profile_id: string;
  revision: number;
  save_schema_version: number;
  content_package_id: string;
  content_version: string;
  state_json: string;
  created_at: string;
  updated_at: string;
}

interface SaveIdentityRow extends Record<string, unknown> {
  profile_id: string;
  revision: number;
  save_schema_version: number;
}

const validateIdentity = (value: string, field: string): void => {
  if (typeof value !== "string" || value.length === 0) {
    throw new SaveRepositoryError("INVALID_INPUT", `${field} must be a non-empty string.`);
  }
}

const validateRevision = (revision: number, field: string): void => {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new SaveRepositoryError(
      "INVALID_INPUT",
      `${field} must be a non-negative safe integer.`,
    );
  }
  // SQLite INTEGER is signed 64-bit, but JavaScript must still be able to
  // represent the next revision exactly when it is returned to the caller.
  if (revision >= Number.MAX_SAFE_INTEGER) {
    throw new SaveRepositoryError(
      "INVALID_INPUT",
      `${field} is too large to increment safely.`,
    );
  }
};

const parseUpdatedAt = (updatedAt: string): string => {
  validateIdentity(updatedAt, "updatedAt");
  const parsed = IsoDateTimeSchema.safeParse(updatedAt);
  if (!parsed.success) {
    throw new SaveRepositoryError(
      "INVALID_SAVE",
      "updatedAt must be an ISO date-time string.",
      parsed.error,
    );
  }
  return parsed.data;
};

const rowToEnvelope = (row: SaveRow): SaveEnvelope => {
  let state: unknown;
  try {
    state = JSON.parse(row.state_json);
  } catch (error) {
    throw new SaveRepositoryError(
      "INVALID_SAVE",
      "The stored save state is not valid JSON.",
      error,
    );
  }

  return parseStoredSaveEnvelope({
    saveId: row.save_id,
    profileId: row.profile_id,
    revision: row.revision,
    saveSchemaVersion: row.save_schema_version,
    contentRef: {
      packageId: row.content_package_id,
      version: row.content_version,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    state,
  });
};

/**
 * SQLite-backed implementation of the SaveRepository contract. Game rules are
 * intentionally absent: this class validates the serializable envelope and
 * atomically stores one complete GameState document.
 */
export class SqliteSaveRepository implements SaveRepository {
  constructor(private readonly database: SqlDatabase) {}

  async load(saveId: string, profileId: string): Promise<SaveEnvelope | null> {
    validateIdentity(saveId, "saveId");
    validateIdentity(profileId, "profileId");

    const rows = await this.database.select<SaveRow>(
      `SELECT save_id, profile_id, revision, save_schema_version,
              content_package_id, content_version, state_json, created_at, updated_at
         FROM saves
        WHERE save_id = $1 AND profile_id = $2`,
      [saveId, profileId],
    );
    const row = rows[0];
    // Unknown IDs and another Profile's save have the same public result.
    if (!row) return null;
    return rowToEnvelope(row);
  }

  async create(save: SaveEnvelope): Promise<void> {
    const parsed = parseSaveEnvelopeForStorage(save);
    const stateJson = JSON.stringify(parsed.state);

    // ON CONFLICT DO NOTHING gives an unambiguous duplicate result without a
    // read-then-write race. Any transport/database error is intentionally
    // allowed to escape as an unknown write outcome.
    const result = await this.database.execute(
      `INSERT INTO saves (
         save_id, profile_id, revision, save_schema_version,
         content_package_id, content_version, state_json, created_at, updated_at
       )
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
        WHERE EXISTS (SELECT 1 FROM profiles WHERE profile_id = $2)
       ON CONFLICT(save_id) DO NOTHING`,
      [
        parsed.saveId,
        parsed.profileId,
        parsed.revision,
        parsed.saveSchemaVersion,
        parsed.contentRef.packageId,
        parsed.contentRef.version,
        stateJson,
        parsed.createdAt,
        parsed.updatedAt,
      ],
    );

    if (result.rowsAffected === 0) {
      const existing = await this.database.select<SaveIdentityRow>(
        "SELECT profile_id, revision, save_schema_version FROM saves WHERE save_id = $1",
        [parsed.saveId],
      );
      if (existing[0]) {
        throw new SaveRepositoryError(
          "SAVE_ALREADY_EXISTS",
          `A save with id "${parsed.saveId}" already exists.`,
        );
      }
      throw new SaveRepositoryError(
        "PROFILE_MISMATCH",
        `Profile "${parsed.profileId}" does not exist.`,
      );
    }
    if (result.rowsAffected !== 1) {
      throw new Error(`Save insert affected ${result.rowsAffected} rows; expected exactly one.`);
    }
  }

  async commit(input: SaveCommitInput): Promise<SaveCommitResult> {
    validateIdentity(input.saveId, "saveId");
    validateIdentity(input.profileId, "profileId");
    validateRevision(input.expectedRevision, "expectedRevision");
    const updatedAt = parseUpdatedAt(input.updatedAt);

    // Parse before the first await. Zod returns a validated data clone, so a
    // caller cannot mutate the object while the SQL request is in flight and
    // change what gets stored. JSON encoding is then done from that clone.
    const parsedState: GameState = parseGameStateForStorage(input.nextState);
    const stateJson = JSON.stringify(parsedState);

    // Validate the current row before writing. This protects a corrupt save or
    // an unsupported future schema from being silently overwritten. A v1 row
    // is valid here and is upgraded by the actual commit below.
    const currentRows = await this.database.select<SaveRow>(
      `SELECT save_id, profile_id, revision, save_schema_version,
              content_package_id, content_version, state_json, created_at, updated_at
         FROM saves
        WHERE save_id = $1`,
      [input.saveId],
    );
    const current = currentRows[0];
    if (!current) {
      throw new SaveRepositoryError("SAVE_NOT_FOUND", `Save "${input.saveId}" does not exist.`);
    }
    if (current.profile_id !== input.profileId) {
      throw new SaveRepositoryError(
        "PROFILE_MISMATCH",
        `Save "${input.saveId}" does not belong to profile "${input.profileId}".`,
      );
    }
    if (current.save_schema_version !== 1 && current.save_schema_version !== 2) {
      throw new SaveRepositoryError(
        "INVALID_SAVE",
        `Save "${input.saveId}" uses unsupported schema version ${current.save_schema_version}.`,
      );
    }
    // Validate the existing JSON without changing it. v1 migration happens in
    // memory at this boundary and is intentionally not persisted by load.
    rowToEnvelope(current);
    if (current.revision !== input.expectedRevision) {
      throw new SaveRepositoryError(
        "REVISION_CONFLICT",
        `Save "${input.saveId}" is at revision ${current.revision}; expected ${input.expectedRevision}.`,
      );
    }

    const result = await this.database.execute(
      `UPDATE saves
          SET state_json = $1,
              revision = revision + 1,
              save_schema_version = 2,
              updated_at = $2
        WHERE save_id = $3
          AND profile_id = $4
          AND revision = $5
          AND save_schema_version IN (1, 2)`,
      [stateJson, updatedAt, input.saveId, input.profileId, input.expectedRevision],
    );

    if (result.rowsAffected === 1) {
      return { revision: input.expectedRevision + 1 };
    }
    if (result.rowsAffected !== 0) {
      throw new Error(`Save compare-and-swap affected ${result.rowsAffected} rows; expected one.`);
    }

    // A zero-row conditional update is the only known non-success result. The
    // diagnostic read distinguishes the public contract errors. If it fails,
    // its original error remains visible; it is never disguised as a safe
    // retryable repository error because the write outcome is not knowable.
    const identityRows = await this.database.select<SaveIdentityRow>(
      "SELECT profile_id, revision, save_schema_version FROM saves WHERE save_id = $1",
      [input.saveId],
    );
    const identity = identityRows[0];
    if (!identity) {
      throw new SaveRepositoryError("SAVE_NOT_FOUND", `Save "${input.saveId}" does not exist.`);
    }
    if (identity.profile_id !== input.profileId) {
      throw new SaveRepositoryError(
        "PROFILE_MISMATCH",
        `Save "${input.saveId}" does not belong to profile "${input.profileId}".`,
      );
    }
    if (identity.save_schema_version !== 1 && identity.save_schema_version !== 2) {
      throw new SaveRepositoryError(
        "INVALID_SAVE",
        `Save "${input.saveId}" uses unsupported schema version ${identity.save_schema_version}.`,
      );
    }
    if (identity.revision !== input.expectedRevision) {
      throw new SaveRepositoryError(
        "REVISION_CONFLICT",
        `Save "${input.saveId}" is at revision ${identity.revision}; expected ${input.expectedRevision}.`,
      );
    }

    throw new Error("Save compare-and-swap affected no rows for an otherwise matching save.");
  }
}
