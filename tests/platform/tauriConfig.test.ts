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
    expect(Object.keys(config.bundle.resources)).toEqual(["../content/"]);
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
});
