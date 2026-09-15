import { describe, expect, it } from "vitest";
import {
  MAX_PROFILE_AVATAR_BYTES,
  profileInitial,
  validateProfileAvatar,
} from "../../src/ui/profile/profileAvatar";

describe("Profile avatar helpers", () => {
  it("uses the first Unicode character and a stable empty fallback", () => {
    expect(profileInitial("  林记录员", "档")).toBe("林");
    expect(profileInitial(" eagle", "P")).toBe("E");
    expect(profileInitial(" ", "P")).toBe("P");
  });

  it("accepts only image files within the local preview limit", () => {
    expect(validateProfileAvatar({ type: "image/png", size: MAX_PROFILE_AVATAR_BYTES })).toBeNull();
    expect(validateProfileAvatar({ type: "text/plain", size: 10 })).toBe("invalidType");
    expect(validateProfileAvatar({ type: "image/jpeg", size: MAX_PROFILE_AVATAR_BYTES + 1 })).toBe(
      "tooLarge",
    );
  });
});
