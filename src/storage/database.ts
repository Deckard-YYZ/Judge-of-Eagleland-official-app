import type TauriDatabase from "@tauri-apps/plugin-sql";

import { STORAGE_SCHEMA_TABLES, STORAGE_SCHEMA_VERSION, type SqlDatabase } from "./schema";

/** The relative path is resolved by the SQL plugin under Tauri's app directory. */
export const DATABASE_URL = "sqlite:judge.db";

export interface DatabaseInitializationOptions {
  /** SQL plugin connection string; defaults to the app's judge.db. */
  databaseUrl?: string;
  /** Dependency injection seam used by tests and host-specific composition. */
  loadDatabase?: (databaseUrl: string) => Promise<SqlDatabase>;
}

export class DatabaseInitializationError extends Error {
  readonly code = "DATABASE_INITIALIZATION_FAILED";
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "DatabaseInitializationError";
    this.cause = cause;
  }
}

interface SchemaTableRow extends Record<string, unknown> {
  name: string;
}

interface SchemaColumnRow extends Record<string, unknown> {
  name: string;
}

/**
 * Adapter around the Tauri SQL plugin. Repositories depend on the small
 * `SqlDatabase` interface instead of importing Tauri APIs themselves, which
 * keeps SQL statements and error handling testable in a real SQLite process.
 */
export class TauriSqlDatabase implements SqlDatabase {
  readonly databaseUrl: string;

  constructor(
    private readonly database: Pick<TauriDatabase, "execute" | "select" | "close">,
    databaseUrl: string,
  ) {
    this.databaseUrl = databaseUrl;
  }

  execute(query: string, bindValues: readonly unknown[] = []) {
    return this.database.execute(query, [...bindValues]);
  }

  select<T extends Record<string, unknown>>(
    query: string,
    bindValues: readonly unknown[] = [],
  ): Promise<T[]> {
    return this.database.select<T[]>(query, [...bindValues]);
  }

  async close(): Promise<void> {
    await this.database.close();
  }
}

async function loadTauriDatabase(databaseUrl: string): Promise<SqlDatabase> {
  // Keep the browser preview independent from Tauri's invoke bridge. The
  // import is evaluated only when the desktop composition asks for SQLite.
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  const database = await Database.load(databaseUrl);
  return new TauriSqlDatabase(database, databaseUrl);
}

/**
 * Verify that all columns required by the current repositories are present.
 * Tauri's `Database.load` applies registered migrations before resolving, so
 * this check is deliberately read-only and does not duplicate migration work.
 */
export async function verifyStorageSchema(database: SqlDatabase): Promise<void> {
  const tables = await database.select<SchemaTableRow>(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  const tableNames = new Set(tables.map((row) => row.name));

  for (const table of STORAGE_SCHEMA_TABLES) {
    if (!tableNames.has(table.name)) {
      throw new DatabaseInitializationError(
        `Storage migration ${STORAGE_SCHEMA_VERSION} is incomplete: table "${table.name}" is missing.`,
      );
    }

    // Table names come exclusively from the static migration definition above;
    // interpolation is safe here and avoids a PRAGMA parameter limitation.
    const columns = await database.select<SchemaColumnRow>(
      `PRAGMA table_info("${table.name}")`,
    );
    const columnNames = new Set(columns.map((row) => row.name));
    for (const column of table.columns) {
      if (!columnNames.has(column)) {
        throw new DatabaseInitializationError(
          `Storage migration ${STORAGE_SCHEMA_VERSION} is incomplete: column "${table.name}.${column}" is missing.`,
        );
      }
    }
  }
}

/**
 * Open the production Tauri database and fail loudly if its migrations did not
 * create the storage schema. Callers should not silently replace this with an
 * in-memory repository after an initialization failure.
 */
export async function initializeDatabase(
  options: DatabaseInitializationOptions = {},
): Promise<SqlDatabase> {
  const databaseUrl = options.databaseUrl ?? DATABASE_URL;
  const load = options.loadDatabase ?? loadTauriDatabase;
  let database: SqlDatabase | undefined;

  try {
    database = await load(databaseUrl);
    await verifyStorageSchema(database);
    return database;
  } catch (error) {
    await database?.close?.().catch(() => undefined);
    if (error instanceof DatabaseInitializationError) {
      throw error;
    }
    throw new DatabaseInitializationError(
      "Could not initialize or verify the SQLite storage database.",
      error,
    );
  }
}
