import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { SqlDatabase, SqlExecuteResult } from "../../../src/storage/schema";

/** Small adapter used only by storage tests; production uses TauriSqlDatabase. */
export class NodeSqliteTestDatabase implements SqlDatabase {
  readonly native: DatabaseSync;

  constructor(native: DatabaseSync) {
    this.native = native;
  }

  async execute(query: string, bindValues: readonly unknown[] = []): Promise<SqlExecuteResult> {
    const statement = this.native.prepare(query);
    const bindings = toNamedBindings(bindValues);
    const result = bindings.length === 0 ? statement.run() : statement.run(bindings[0]);
    return {
      rowsAffected: Number(result.changes),
      lastInsertId: Number(result.lastInsertRowid),
    };
  }

  async select<T extends Record<string, unknown>>(
    query: string,
    bindValues: readonly unknown[] = [],
  ): Promise<T[]> {
    const statement = this.native.prepare(query);
    const bindings = toNamedBindings(bindValues);
    return (bindings.length === 0 ? statement.all() : statement.all(bindings[0])) as T[];
  }

  async close(): Promise<void> {
    this.native.close();
  }
}

/** node:sqlite treats `$1` as a named parameter, unlike Tauri SQL's array API. */
type SqliteInputValue = null | number | bigint | string | NodeJS.ArrayBufferView;

const toSqliteInputValue = (value: unknown): SqliteInputValue => {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "bigint" || ArrayBuffer.isView(value)) {
    return value as SqliteInputValue;
  }
  // SQLite has no boolean storage type. Keep the test adapter convenient for
  // direct fixture inserts while matching SQLite's integer representation.
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new TypeError("Unsupported node:sqlite test bind value.");
};

const toNamedBindings = (
  bindValues: readonly unknown[],
): [] | [Record<string, SqliteInputValue>] =>
  bindValues.length === 0
    ? []
    : [
        Object.fromEntries(
          bindValues.map((value, index) => [`$${index + 1}`, toSqliteInputValue(value)]),
        ),
      ];

export interface SqliteTestDatabase {
  readonly filePath: string;
  readonly database: NodeSqliteTestDatabase;
  openConnection(): NodeSqliteTestDatabase;
  cleanup(): Promise<void>;
}

const applyInitialMigration = (database: DatabaseSync): void => {
  // Keep this path tied to the Rust include_str! source. The test deliberately
  // executes the same migration text rather than maintaining a TS copy.
  const migrationPath = new URL("../../../src-tauri/migrations/001_initial.sql", import.meta.url);
  const migrationSql = readFileSync(migrationPath, "utf8");
  database.exec("BEGIN");
  try {
    database.exec(migrationSql);
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the migration error; the test cleanup still closes the file.
    }
    throw error;
  }
};

const removeTemporaryDirectory = (directory: string): void => {
  const tempRoot = resolve(tmpdir());
  const target = resolve(directory);
  const isChild = target.startsWith(`${tempRoot}\\`) || target.startsWith(`${tempRoot}/`);
  if (!isChild || !basename(target).startsWith("eagle-judge-storage-")) {
    throw new Error(`Refusing to clean an unexpected SQLite test directory: ${target}`);
  }
  rmSync(target, { recursive: true, force: true });
};

/** Open a real temporary SQLite file with the Rust-registered migration applied. */
export function createSqliteTestDatabase(): SqliteTestDatabase {
  const directory = mkdtempSync(join(tmpdir(), "eagle-judge-storage-"));
  const filePath = join(directory, "judge.db");
  const connections = new Set<NodeSqliteTestDatabase>();

  const openConnection = (): NodeSqliteTestDatabase => {
    const connection = new NodeSqliteTestDatabase(new DatabaseSync(filePath));
    connections.add(connection);
    return connection;
  };

  const primary = openConnection();
  try {
    applyInitialMigration(primary.native);
  } catch (error) {
    for (const connection of connections) connection.native.close();
    removeTemporaryDirectory(directory);
    throw error;
  }

  return {
    filePath,
    database: primary,
    openConnection,
    async cleanup(): Promise<void> {
      for (const connection of connections) {
        try {
          await connection.close();
        } catch {
          // Cleanup should not mask an assertion failure from the test body.
        }
      }
      removeTemporaryDirectory(directory);
    },
  };
}
