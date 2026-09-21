import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

interface TauriConfig {
  readonly bundle: {
    readonly active: boolean;
    readonly resources: Record<string, string>;
  };
  readonly app: {
    readonly security: {
      readonly assetProtocol: {
        readonly enable: boolean;
        readonly scope: readonly string[];
      };
      readonly csp: string;
    };
  };
  readonly plugins?: {
    readonly sql?: {
      readonly preload?: readonly string[];
    };
  };
}

interface CapabilityConfig {
  readonly windows: readonly string[];
  readonly permissions: readonly string[];
}

const readJson = async (relativePath: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8")) as unknown;

const readTauriConfig = async (): Promise<TauriConfig> =>
  (await readJson("src-tauri/tauri.conf.json")) as TauriConfig;

const readCapabilityConfig = async (): Promise<CapabilityConfig> =>
  (await readJson("src-tauri/capabilities/default.json")) as CapabilityConfig;

describe("Tauri resource and permission configuration", () => {
  it("keeps bundled content mapped to the resolver's package root", async () => {
    const config = await readTauriConfig();

    expect(config.bundle).toMatchObject({
      active: false,
      resources: { "../content/": "content/" },
    });
    // Ship only the fixed inference assets. Tokenizer dictionaries, Python
    // environments and download caches must never enter the desktop package.
    expect(config.bundle.resources).toEqual({
      "../content/": "content/",
      "../artifacts/voice/model/decoder-epoch-13-avg-2-chunk-16-left-64.onnx":
        "voice/decoder-epoch-13-avg-2-chunk-16-left-64.onnx",
      "../artifacts/voice/model/encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx":
        "voice/encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx",
      "../artifacts/voice/model/joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx":
        "voice/joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx",
      "../artifacts/voice/model/tokens.txt": "voice/tokens.txt",
      "../artifacts/voice/native/lib/sherpa-onnx-c-api.dll": "sherpa-onnx-c-api.dll",
      "../artifacts/voice/native/lib/onnxruntime.dll": "onnxruntime.dll",
      "../artifacts/voice/native/lib/onnxruntime_providers_shared.dll":
        "onnxruntime_providers_shared.dll",
      "../artifacts/tts/model/model.onnx": "tts/model.onnx",
      "../artifacts/tts/model/tokens.txt": "tts/tokens.txt",
      "../artifacts/tts/model/lexicon.txt": "tts/lexicon.txt",
      "../artifacts/tts/model/date.fst": "tts/date.fst",
      "../artifacts/tts/model/number.fst": "tts/number.fst",
      "../artifacts/tts/model/phone.fst": "tts/phone.fst",
      "../artifacts/tts/model/LICENSE": "tts/LICENSE",
      "../artifacts/tts/model/README.md": "tts/README.md",
    });
  });

  it("limits the asset protocol and allows its CSP origins", async () => {
    const config = await readTauriConfig();
    const security = config.app.security;

    expect(security.assetProtocol).toEqual({
      enable: true,
      scope: ["$RESOURCE/content/**/*"],
    });
    expect(security.csp).toContain("img-src 'self' asset: http://asset.localhost blob: data:");
    expect(security.csp).toContain("media-src 'self' asset: http://asset.localhost blob:");
    expect(security.csp).not.toContain("https://asset.localhost");
  });

  it("does not preload the database and grants only used capability commands", async () => {
    const config = await readTauriConfig();
    const capability = await readCapabilityConfig();

    expect(config.plugins?.sql?.preload).toBeUndefined();
    expect(capability.windows).toEqual(["main"]);
    expect(capability.permissions).toEqual([
      "core:path:allow-resolve-directory",
      "core:window:allow-set-theme",
      "sql:allow-close",
      "sql:allow-load",
      "sql:allow-select",
      "sql:allow-execute",
    ]);
    expect(capability.permissions).not.toContain("core:default");
    expect(capability.permissions).not.toContain("sql:default");
  });

  it("enables Tauri's asset protocol feature in the native crate", async () => {
    const cargoToml = await readFile(
      new URL("../../src-tauri/Cargo.toml", import.meta.url),
      "utf8",
    );

    expect(cargoToml).toMatch(/tauri\s*=\s*\{[^\n]*features\s*=\s*\["protocol-asset"\]/u);
  });

  it("registers the same SQLite migration path used by the database plugin", async () => {
    const libRs = await readFile(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
    const migrationSql = await readFile(
      new URL("../../src-tauri/migrations/001_initial.sql", import.meta.url),
      "utf8",
    );

    expect(libRs).toContain('include_str!("../migrations/001_initial.sql")');
    expect(libRs).toContain('.add_migrations("sqlite:judge.db", migrations)');
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS profiles");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS saves");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS settings");
  });
});
