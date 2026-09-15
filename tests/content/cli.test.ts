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
const VALID_PACKAGE = path.join(REPOSITORY_ROOT, "content", "validator-fixture", "1.0.0");
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
  it("validates an explicit package directory with exit code zero", () => {
    const result = runCli(VALID_PACKAGE);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`VALID ${path.join("content", "validator-fixture", "1.0.0")}`);
    expect(result.stdout).toContain("validator-fixture@1.0.0, 3 cases");
    expect(result.stderr).toBe("");
  });

  it("discovers content/<packageId>/<version> when no arguments are supplied", () => {
    const result = runCli();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("validator-fixture@1.0.0, 3 cases");
  });

  it("accepts a content root and continues across valid and invalid package arguments", () => {
    const rootResult = runCli(path.join(REPOSITORY_ROOT, "content"));
    expect(rootResult.status).toBe(0);
    expect(rootResult.stdout).toContain("validator-fixture@1.0.0");

    const mixedResult = runCli(VALID_PACKAGE, INVALID_PACKAGE);
    expect(mixedResult.status).toBe(1);
    expect(mixedResult.stdout).toContain("validator-fixture@1.0.0");
    expect(mixedResult.stderr).toContain("CASE_KEY_ID_MISMATCH");
  });

  it("prints every stable validation diagnostic with file, object, path, code, and message", () => {
    const first = runCli(INVALID_PACKAGE);
    const second = runCli(INVALID_PACKAGE);

    expect(first.status).toBe(1);
    expect(first.stderr).toBe(second.stderr);
    const diagnostics = first.stderr.trim().split(/\r?\n/u);
    expect(diagnostics.length).toBeGreaterThan(10);
    expect(first.stderr).toContain(
      "cases/case_bad.json | object=case_bad | path=cases.case_bad.id | CASE_KEY_ID_MISMATCH |",
    );
    expect(first.stderr).toContain(
      "progression.json | object=duplicate_unlock | path=unlockRules[0].when.all[0].attributeId | ATTRIBUTE_REFERENCE_INVALID |",
    );
    expect(first.stderr).toContain(
      "stories/ending_story.json | object=ending_story | path=stories.ending_story.steps[0].assetId | ASSET_REFERENCE_INVALID |",
    );
    expect(first.stderr).toContain("assets.json | object=bad_path | path=assets.bad_path.path");
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
