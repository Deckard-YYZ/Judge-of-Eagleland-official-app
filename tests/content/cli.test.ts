// @ts-expect-error Node typings are intentionally absent from the browser production tsconfig.
import { spawnSync } from "node:child_process";
// @ts-expect-error Node typings are intentionally absent from the browser production tsconfig.
import path from "node:path";
// @ts-expect-error Node typings are intentionally absent from the browser production tsconfig.
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

declare const process: { readonly execPath: string };

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TSX_CLI = path.join(REPOSITORY_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const LOCALIZED_PACKAGE = path.join(REPOSITORY_ROOT, "content", "minimal-test-package", "1.0.0");
const INVALID_PACKAGE = path.join(
  REPOSITORY_ROOT,
  "tests",
  "fixtures",
  "content",
  "invalid",
  "1.0.0",
);

const runCli = (...args: string[]) =>
  spawnSync(
    process.execPath,
    [TSX_CLI, path.join(REPOSITORY_ROOT, "scripts", "validate-content.ts"), ...args],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      timeout: 20_000,
    },
  );

describe("validate-content CLI", () => {
  it("validates an explicit schema-v2 package directory with exit code zero", () => {
    const result = runCli(LOCALIZED_PACKAGE);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `VALID ${path.join("content", "minimal-test-package", "1.0.0")}`,
    );
    expect(result.stdout).toContain("minimal-test-package@1.0.0, 2 cases");
    expect(result.stderr).toBe("");
  });

  it("discovers content/<packageId>/<version> when no arguments are supplied", () => {
    const result = runCli();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("minimal-test-package@1.0.0, 2 cases");
  });

  it("validates the schema-v2 rules plus locale physical package", () => {
    const result = runCli(LOCALIZED_PACKAGE);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("minimal-test-package@1.0.0, 2 cases");
    expect(result.stderr).toBe("");
  });

  it("accepts a content root and continues across valid and invalid package arguments", () => {
    const rootResult = runCli(path.join(REPOSITORY_ROOT, "content"));
    expect(rootResult.status).toBe(0);
    expect(rootResult.stdout).toContain("minimal-test-package@1.0.0");

    const mixedResult = runCli(LOCALIZED_PACKAGE, INVALID_PACKAGE);
    expect(mixedResult.status).toBe(1);
    expect(mixedResult.stdout).toContain("minimal-test-package@1.0.0");
    expect(mixedResult.stderr).toContain("no content package directories found");
  });

  it("uses non-zero exits for usage and I/O errors", () => {
    const usageResult = runCli("--unknown");
    expect(usageResult.status).toBe(1);
    expect(usageResult.stderr).toContain("Usage:");

    const ioResult = runCli(path.join(REPOSITORY_ROOT, "content", "does-not-exist"));
    expect(ioResult.status).toBe(1);
    expect(ioResult.stderr).toContain(`ERROR ${path.join("content", "does-not-exist")}:`);
  });
});
