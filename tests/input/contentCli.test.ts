import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const loadedPackage = vi.hoisted(() => ({
  ok: true,
  gameContent: {
    manifest: {
      packageId: "minimal-test-package",
      version: "1.0.0",
      supportedLocales: ["zh-CN", "en-US"],
    },
    stories: { input: { steps: [{ type: "actionInput", targetActionId: "wave" }] } },
    cases: {},
  },
}));

// Exercise the CLI's capability gate after an already validated content package is loaded.
vi.mock("../../src/content/localizedPackageFormat", () => ({
  loadSplitContentPackage: () => loadedPackage,
}));

const originalArgv = process.argv;
const originalExitCode = process.exitCode;

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.doUnmock("../../src/input/actionLexicons");
  vi.restoreAllMocks();
  vi.resetModules();
});

async function runCliWithLexicons(lexicons: unknown) {
  vi.resetModules();
  vi.doMock("../../src/input/actionLexicons", () => ({ actionLexicons: lexicons }));
  process.argv = [
    process.execPath,
    "validate-content.ts",
    fileURLToPath(new URL("../../content/minimal-test-package/1.0.0", import.meta.url)),
  ];
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  await import("../../scripts/validate-content");
  return { output, errors };
}

describe("content CLI text capability gate", () => {
  it("accepts a target that can be entered in every released language", async () => {
    const { output, errors } = await runCliWithLexicons({
      "zh-CN": { wave: ["挥手"] },
      "en-US": { wave: ["wave"] },
    });
    expect(process.exitCode).toBe(0);
    expect(output).toHaveBeenCalledWith(expect.stringContaining("VALID"));
    expect(errors).not.toHaveBeenCalled();
  });

  it("fails the build with the package, locale and unreachable target identified", async () => {
    const { output, errors } = await runCliWithLexicons({
      "zh-CN": { wave: ["挥手"] },
      "en-US": { salute: ["salute"] },
    });
    expect(process.exitCode).toBe(1);
    expect(output).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining(path.join("content", "minimal-test-package", "1.0.0")),
    );
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining("locale=en-US | action=wave | UNREACHABLE_ACTION"),
    );
  });
});
