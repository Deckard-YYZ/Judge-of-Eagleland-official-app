import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DATABASE_URL,
  DatabaseInitializationError,
  initializeDatabase,
} from "../../src/storage/database";
import { initializeStorage } from "../../src/storage";
import type { SqlDatabase } from "../../src/storage/schema";
import {
  createSqliteTestDatabase,
  type SqliteTestDatabase,
} from "../fixtures/storage/sqliteTestDatabase";

describe("SQLite storage initialization", () => {
  let testDatabase: SqliteTestDatabase;

  beforeEach(() => {
    testDatabase = createSqliteTestDatabase();
  });

  afterEach(async () => {
    await testDatabase.cleanup();
  });

  it("uses the migration-backed database and composes all repositories", async () => {
    let requestedUrl: string | undefined;
    const storage = await initializeStorage({
      databaseUrl: "sqlite:storage-test.db",
      loadDatabase: async (databaseUrl) => {
        requestedUrl = databaseUrl;
        return testDatabase.database;
      },
    });

    expect(requestedUrl).toBe("sqlite:storage-test.db");
    expect(storage.database).toBe(testDatabase.database);
    expect(storage.profiles).toBeDefined();
    expect(storage.saves).toBeDefined();
    expect(storage.settings).toBeDefined();
  });

  it("keeps the production database URL stable", () => {
    expect(DATABASE_URL).toBe("sqlite:judge.db");
  });

  it("fails closed and closes a connection whose schema is incomplete", async () => {
    await testDatabase.database.execute("DROP TABLE settings");
    let closed = false;
    const database: SqlDatabase = {
      execute: (query, bindValues) => testDatabase.database.execute(query, bindValues),
      select: (query, bindValues) => testDatabase.database.select(query, bindValues),
      close: async () => {
        closed = true;
        await testDatabase.database.close();
      },
    };

    await expect(initializeDatabase({ loadDatabase: async () => database })).rejects.toMatchObject({
      code: "DATABASE_INITIALIZATION_FAILED",
      message: 'Storage migration 1 is incomplete: table "settings" is missing.',
    });
    expect(closed).toBe(true);
  });

  it("wraps loader failures without requiring a database cleanup", async () => {
    const failure = new Error("plugin load failed");
    await expect(
      initializeDatabase({ loadDatabase: async () => Promise.reject(failure) }),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof DatabaseInitializationError &&
        error.code === "DATABASE_INITIALIZATION_FAILED" &&
        error.cause === failure
      );
    });
  });
});
