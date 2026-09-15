import { describe, expect, it } from "vitest";
import { createDemoProfileEntry } from "../../src/app/demoProfiles";
import { normalizeProfileDisplayName } from "../../src/application/profileEntry";

describe("demo Profile entry", () => {
  it("normalizes local display names with one shared rule", () => {
    expect(normalizeProfileDisplayName("  第七\t审理员\n ")).toBe("第七 审理员");
    expect(normalizeProfileDisplayName("   ")).toBe("");
  });

  it("enters and registers local profiles without exposing a repository", async () => {
    const entry = createDemoProfileEntry();
    expect(entry.getSnapshot().profiles).toEqual([
      { profileId: "demo-profile", displayName: "演示档案员" },
    ]);

    const existing = await entry.enter("demo-profile");
    expect(existing.ok).toBe(true);
    if (existing.ok) {
      expect(existing.session.getSnapshot().status).toBe("ready");
    }

    const created = await entry.register("  新   档案员  ");
    expect(created.ok).toBe(true);
    expect(entry.getSnapshot().profiles.at(-1)).toEqual({
      profileId: "demo-profile-1",
      displayName: "新 档案员",
    });
    expect(await entry.register("新 档案员")).toMatchObject({
      ok: false,
      error: { code: "PROFILE_EXISTS" },
    });
  });
});
