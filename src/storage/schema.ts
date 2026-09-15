/** Result returned by the SQL plugin and by the node:sqlite test adapter. */
export interface SqlExecuteResult {
  rowsAffected: number;
  lastInsertId?: number;
}

/**
 * The repositories use only this narrow asynchronous SQL surface. Keeping
 * bind values separate from SQL text is part of the storage boundary.
 */
export interface SqlDatabase {
  execute(query: string, bindValues?: readonly unknown[]): Promise<SqlExecuteResult>;
  select<T extends Record<string, unknown>>(
    query: string,
    bindValues?: readonly unknown[],
  ): Promise<T[]>;
  close?(): Promise<void>;
}

export interface StorageSchemaTable {
  readonly name: string;
  readonly columns: readonly string[];
}

/** The migration version registered by `src-tauri/src/lib.rs`. */
export const STORAGE_SCHEMA_VERSION = 1;

/** Core tables required by Profile, Save and Settings repositories. */
export const STORAGE_SCHEMA_TABLES: readonly StorageSchemaTable[] = Object.freeze([
  {
    name: "profiles",
    columns: ["profile_id", "login_name", "display_name", "created_at"],
  },
  {
    name: "saves",
    columns: [
      "save_id",
      "profile_id",
      "revision",
      "save_schema_version",
      "content_package_id",
      "content_version",
      "state_json",
      "created_at",
      "updated_at",
    ],
  },
  {
    name: "settings",
    columns: ["scope", "setting_key", "value_json"],
  },
]);
