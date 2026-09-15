export {
  DATABASE_URL,
  DatabaseInitializationError,
  TauriSqlDatabase,
  initializeDatabase,
  verifyStorageSchema,
  type DatabaseInitializationOptions,
} from "./database";
export {
  ProfileRecordSchema,
  ProfileRepositoryError,
  SqliteProfileRepository,
  isProfileRepositoryError,
  normalizeProfileLoginName,
  type ProfileRecord,
  type ProfileRepository,
  type ProfileRepositoryErrorCode,
} from "./profileRepository";
export {
  SettingsRepositoryError,
  SqliteSettingsRepository,
  isSettingsRepositoryError,
  type SettingRecord,
  type SettingsRepository,
  type SettingsRepositoryErrorCode,
  type SettingsScope,
} from "./settingsRepository";
export {
  SqliteSaveRepository,
  type SaveCommitInput,
  type SaveCommitResult,
  type SaveRepository,
} from "./saveRepository";
export {
  SqlDatabase,
  STORAGE_SCHEMA_TABLES,
  STORAGE_SCHEMA_VERSION,
  type SqlExecuteResult,
  type StorageSchemaTable,
} from "./schema";

import { initializeDatabase, type DatabaseInitializationOptions } from "./database";
import { SqliteProfileRepository, type ProfileRepository } from "./profileRepository";
import { SqliteSaveRepository } from "./sqliteSaveRepository";
import { SqliteSettingsRepository, type SettingsRepository } from "./settingsRepository";
import type { SaveRepository } from "./saveRepository";
import type { SqlDatabase } from "./schema";

export interface StorageRepositories {
  readonly database: SqlDatabase;
  readonly profiles: ProfileRepository;
  readonly saves: SaveRepository;
  readonly settings: SettingsRepository;
}

/** Construct all repositories over one initialized SQLite connection. */
export const createStorageRepositories = (database: SqlDatabase): StorageRepositories => ({
  database,
  profiles: new SqliteProfileRepository(database),
  saves: new SqliteSaveRepository(database),
  settings: new SqliteSettingsRepository(database),
});

/** Open, validate, and compose the production storage line in one call. */
export async function initializeStorage(
  options: DatabaseInitializationOptions = {},
): Promise<StorageRepositories> {
  const database = await initializeDatabase(options);
  return createStorageRepositories(database);
}
