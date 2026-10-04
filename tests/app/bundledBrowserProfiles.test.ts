import { describe, expect, it } from "vitest";
import { createBundledBrowserProfileEntry } from "../../src/app/bundledBrowserProfiles";

describe("installed main flow browser entry", () => {
  it("loads the generated package with production rules and preserves interrupted tutorial completion", async () => {
    const entry = await createBundledBrowserProfileEntry({
      packageId: "mainflow-short",
      version: "0.1.0",
    });
    const first = await entry.register("Generated judge");
    if (!first.ok) throw new Error(first.error.message);
    expect(first.session.getSnapshot().envelope!.contentRef).toEqual({
      packageId: "mainflow-short",
      version: "0.1.0",
    });
    expect(first.session.getSnapshot().state!.pendingStoryIds).toEqual(["tutorial"]);
    expect(first.session.getSnapshot().state!.mainFlow!.chats["instance-a"]).toBeDefined();
    const next = await entry.enter(first.profile.profileId);
    if (!next.ok) throw new Error(next.error.message);
    expect(next.session.getSnapshot().state!.pendingStoryIds).toEqual([]);
    expect(next.session.getSnapshot().content!.mainFlow!.chats["chat-a"].title).toBe(
      "书记员消息 A",
    );
  });
});
