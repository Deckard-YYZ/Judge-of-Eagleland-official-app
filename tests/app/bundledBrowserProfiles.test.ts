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

it("initializes the new third attribute only in new-version saves and retains exact old refs", async () => {
  const fresh = await createBundledBrowserProfileEntry();
  const created = await fresh.register("Three axes");
  if (!created.ok) throw new Error(created.error.message);
  expect(created.session.getSnapshot().envelope!.contentRef.version).toBe("1.3.0");
  expect(created.session.getSnapshot().state!.attributes).toEqual({
    restraint: 50,
    authority: 50,
    axis_three: 50,
  });
  expect(
    Object.values(created.session.getSnapshot().content!.attributes).map(
      (attribute) => attribute.label,
    ),
  ).toEqual(["一", "二", "三"]);
  const resumed = await fresh.enter(created.profile.profileId);
  if (!resumed.ok) throw new Error(resumed.error.message);
  expect(resumed.session.getSnapshot().state!.attributes.axis_three).toBe(50);
  const old = await createBundledBrowserProfileEntry({
    packageId: "minimal-test-package",
    version: "1.2.0",
  });
  const oldCreated = await old.register("Old exact ref");
  if (!oldCreated.ok) throw new Error(oldCreated.error.message);
  const oldResumed = await old.enter(oldCreated.profile.profileId);
  if (!oldResumed.ok) throw new Error(oldResumed.error.message);
  expect(oldResumed.session.getSnapshot().envelope!.contentRef.version).toBe("1.2.0");
  expect(oldResumed.session.getSnapshot().state!.attributes).toEqual({
    restraint: 50,
    authority: 50,
  });
});
