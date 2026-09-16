import { z } from "zod";

import type { SqlDatabase } from "./schema";

const NonEmptyStringSchema = z.string().min(1);
const JsonValueSchema = z.json();

/** Settings are intentionally limited to the two scopes defined by the architecture. */
export type SettingsScope = "app" | `profile:${string}`;

export interface SettingRecord {
  readonly scope: SettingsScope;
  readonly key: string;
  readonly value: unknown;
}

export interface SettingsRepository {
  get(scope: SettingsScope, key: string): Promise<unknown | null>;
  set(scope: SettingsScope, key: string, value: unknown): Promise<void>;
  remove(scope: SettingsScope, key: string): Promise<boolean>;
  list(scope: SettingsScope): Promise<readonly SettingRecord[]>;
}

export type SettingsRepositoryErrorCode =
  | "INVALID_INPUT"
  | "INVALID_SETTING"
  | "INVALID_VALUE";

export class SettingsRepositoryError extends Error {
  readonly code: SettingsRepositoryErrorCode;
  readonly cause?: unknown;

  constructor(code: SettingsRepositoryErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "SettingsRepositoryError";
    this.code = code;
    this.cause = cause;
  }
}

export const isSettingsRepositoryError = (
  error: unknown,
): error is SettingsRepositoryError => error instanceof SettingsRepositoryError;

interface SettingRow extends Record<string, unknown> {
  scope: string;
  setting_key: string;
  value_json: string;
}

const validateScope = (scope: string): SettingsScope => {
  if (scope === "app") return scope;
  if (typeof scope === "string" && /^profile:.+/u.test(scope)) return scope as SettingsScope;
  throw new SettingsRepositoryError(
    "INVALID_INPUT",
    'scope must be "app" or a profile scope such as "profile:profile-1".',
  );
};

const validateKey = (key: string): string => {
  const result = NonEmptyStringSchema.safeParse(key);
  if (!result.success || result.data.trim().length === 0) {
    throw new SettingsRepositoryError("INVALID_INPUT", "setting key must be a non-empty string.");
  }
  return result.data;
};

/** Serialize once at the repository edge so stored settings remain JSON data. */
const encodeValue = (value: unknown): string => {
  try {
    const parsed = JsonValueSchema.safeParse(value);
    if (!parsed.success) {
      throw new SettingsRepositoryError(
        "INVALID_VALUE",
        "Setting values must be JSON-serializable.",
        parsed.error,
      );
    }
    // The schema parse also rejects lossy values such as NaN, undefined object
    // members, Date instances, functions and bigint before JSON.stringify runs.
    const encoded = JSON.stringify(parsed.data);
    if (typeof encoded !== "string") {
      throw new SettingsRepositoryError(
        "INVALID_VALUE",
        "Setting values must be JSON-serializable.",
      );
    }
    return encoded;
  } catch (error) {
    if (error instanceof SettingsRepositoryError) throw error;
    // Recursive values can make Zod or JSON.stringify throw before returning a
    // regular validation result. Keep that failure at the settings boundary.
    throw new SettingsRepositoryError(
      "INVALID_VALUE",
      "Setting values must be JSON-serializable.",
      error,
    );
  }
};

const decodeValue = (valueJson: string): unknown => {
  try {
    return JsonValueSchema.parse(JSON.parse(valueJson));
  } catch (error) {
    // Corruption is reported while preserving the original database row; the
    // caller can decide whether to offer a recovery or reset path.
    throw new SettingsRepositoryError(
      "INVALID_SETTING",
      "The stored setting value is not valid JSON.",
      error,
    );
  }
};

const rowToSetting = (row: SettingRow): SettingRecord => ({
  scope: validateScope(row.scope),
  key: validateKey(row.setting_key),
  value: decodeValue(row.value_json),
});

/** SQLite-backed key/value preferences for app and local Profile scopes. */
export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly database: SqlDatabase) {}

  async get(scope: SettingsScope, key: string): Promise<unknown | null> {
    const normalizedScope = validateScope(scope);
    const normalizedKey = validateKey(key);
    const rows = await this.database.select<SettingRow>(
      `SELECT scope, setting_key, value_json
         FROM settings
        WHERE scope = $1 AND setting_key = $2`,
      [normalizedScope, normalizedKey],
    );
    const row = rows[0];
    return row ? decodeValue(row.value_json) : null;
  }

  async set(scope: SettingsScope, key: string, value: unknown): Promise<void> {
    const normalizedScope = validateScope(scope);
    const normalizedKey = validateKey(key);
    const valueJson = encodeValue(value);
    const result = await this.database.execute(
      `INSERT INTO settings (scope, setting_key, value_json)
       VALUES ($1, $2, $3)
       ON CONFLICT(scope, setting_key)
       DO UPDATE SET value_json = excluded.value_json`,
      [normalizedScope, normalizedKey, valueJson],
    );
    if (result.rowsAffected !== 1) {
      // SQLite reports one changed row for an upsert. Any other result signals
      // a schema/driver problem and does not map to a known setting error.
      throw new Error(`Setting upsert affected ${result.rowsAffected} rows; expected exactly one.`);
    }
  }

  async remove(scope: SettingsScope, key: string): Promise<boolean> {
    const normalizedScope = validateScope(scope);
    const normalizedKey = validateKey(key);
    const result = await this.database.execute(
      "DELETE FROM settings WHERE scope = $1 AND setting_key = $2",
      [normalizedScope, normalizedKey],
    );
    if (result.rowsAffected !== 0 && result.rowsAffected !== 1) {
      throw new Error(`Setting delete affected ${result.rowsAffected} rows; expected at most one.`);
    }
    return result.rowsAffected === 1;
  }

  async list(scope: SettingsScope): Promise<readonly SettingRecord[]> {
    const normalizedScope = validateScope(scope);
    const rows = await this.database.select<SettingRow>(
      `SELECT scope, setting_key, value_json
         FROM settings
        WHERE scope = $1
        ORDER BY setting_key ASC`,
      [normalizedScope],
    );
    return rows.map(rowToSetting);
  }
}
