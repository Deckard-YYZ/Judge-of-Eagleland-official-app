const DATABASE_URL = "sqlite:judge.db";
const PROBE_ID = "bootstrap";

export type DatabaseProbeStatus = "memory" | "connected" | "error";

export interface DatabaseProbeResult {
  status: DatabaseProbeStatus;
  databaseUrl: string;
  message: string;
  sampleId?: string;
  error?: string;
}

/** Minimal host information needed by storage; platform remains an assembler concern. */
export interface DatabaseRuntimeGate {
  kind: "browser" | "tauri";
  supportsSqlite: boolean;
}

interface ProbeRow {
  id: string;
  created_at: string;
}

/**
 * Execute one small parameterized write/read cycle against the real plugin.
 * This is deliberately a bootstrap smoke probe, not the SaveRepository.
 */
export async function probeDatabase(runtime: DatabaseRuntimeGate): Promise<DatabaseProbeResult> {
  if (!runtime.supportsSqlite || runtime.kind !== "tauri") {
    return {
      status: "memory",
      databaseUrl: DATABASE_URL,
      message: "浏览器预览使用内存模式；SQLite 仅在 Tauri 桌面运行时启用。",
    };
  }

  try {
    // Dynamic loading keeps the browser preview independent from Tauri APIs.
    const { default: Database } = await import("@tauri-apps/plugin-sql");
    const database = await Database.load(DATABASE_URL);
    try {
      await database.execute(
        "CREATE TABLE IF NOT EXISTS runtime_probe (id TEXT PRIMARY KEY, created_at TEXT NOT NULL)",
      );
      const timestamp = new Date().toISOString();
      await database.execute(
        "INSERT OR REPLACE INTO runtime_probe (id, created_at) VALUES ($1, $2)",
        [PROBE_ID, timestamp],
      );
      const rows = await database.select<ProbeRow[]>(
        "SELECT id, created_at FROM runtime_probe WHERE id = $1",
        [PROBE_ID],
      );
      const row = rows[0];
      if (!row || row.id !== PROBE_ID || row.created_at !== timestamp) {
        throw new Error("SQLite probe read did not return the written marker.");
      }

      return {
        status: "connected",
        databaseUrl: DATABASE_URL,
        sampleId: row.id,
        message: "SQLite 插件已完成一次参数化写入和读取探针。",
      };
    } finally {
      await database.close().catch(() => undefined);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      databaseUrl: DATABASE_URL,
      message: "SQLite 插件初始化失败，尚未启用正式存档写入。",
      error: message,
    };
  }
}
