import { describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { readBundledContentPackage } from "../../src/platform/contentResources";

describe("bundled content transport", () => {
  it("passes only package identity to the restricted native command", async () => {
    const files = { sources: [], fileInventory: [] };
    invoke.mockResolvedValueOnce(files);
    expect(await readBundledContentPackage({ packageId: "package", version: "1.0.0" })).toBe(files);
    expect(invoke).toHaveBeenCalledWith("read_bundled_content_package", {
      packageId: "package",
      version: "1.0.0",
    });
  });
});
