import { expect, it, vi } from "vitest";
import { bootstrapMainFlowPreview } from "../../src/app/mainFlowPreview";

it("uses independent memory profiles even when the host advertises Tauri", async () => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  try {
    const first = await bootstrapMainFlowPreview();
    expect(first.runtime).toBe("browser");
    expect(first.storageMode).toBe("memory-preview");
    const entered = await first.profileEntry.register("Debug only");
    if (!entered.ok) throw new Error(entered.error.message);
    expect(entered.session.getSnapshot().envelope!.contentRef).toEqual({
      packageId: "mainflow-short",
      version: "0.1.0",
    });
    expect(entered.session.getSnapshot().state!.pendingStoryIds).toEqual(["tutorial"]);
    const second = await bootstrapMainFlowPreview();
    expect(
      second.profileEntry.getSnapshot().profiles.map((profile) => profile.displayName),
    ).not.toContain("Debug only");
  } finally {
    vi.unstubAllGlobals();
  }
});
