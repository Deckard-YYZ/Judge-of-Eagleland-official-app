import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { exportTables } from "../../scripts/content/build";

// Git runs against a real temporary checkout; .NET is observed without executing a build.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: vi.fn((...args: Parameters<typeof actual.execFileSync>) =>
      args[0] === "dotnet" ? Buffer.from("") : actual.execFileSync(...args),
    ),
  };
});

async function fixture() {
  const scratch = path.resolve("artifacts/content-authoring/tool-tests");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, "checkout-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();
  git("init", "--quiet");
  await writeFile(path.join(directory, ".gitignore"), "bin/\nobj/\n");
  git("add", ".gitignore");
  git(
    "-c",
    "user.name=Authoring Test",
    "-c",
    "user.email=authoring@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  const lock = { commit: git("rev-parse", "HEAD"), project: "Luban.csproj", dll: "bin/Luban.dll" };
  return { directory, lock };
}

describe("pinned tool checkout validation", () => {
  it.each(["Unexpected.cs", "Directory.Build.targets"])(
    "rejects untracked %s before starting dotnet",
    async (filename) => {
      const { directory, lock } = await fixture();
      await writeFile(path.join(directory, filename), "untracked build input");
      vi.mocked(execFileSync).mockClear();
      expect(() => exportTables(directory, directory, directory, lock)).toThrow(
        "LUBAN_VERSION_MISMATCH",
      );
      expect(vi.mocked(execFileSync).mock.calls.some((call) => call[0] === "dotnet")).toBe(false);
    },
  );

  it("allows normal ignored bin/obj output before building the clean pinned checkout", async () => {
    const { directory, lock } = await fixture();
    for (const name of ["bin", "obj"]) {
      await mkdir(path.join(directory, name));
      await writeFile(path.join(directory, name, "output.txt"), "build output");
    }
    vi.mocked(execFileSync).mockClear();
    exportTables(directory, directory, directory, lock);
    expect(vi.mocked(execFileSync).mock.calls.filter((call) => call[0] === "dotnet")).toHaveLength(
      2,
    );
  });
});
