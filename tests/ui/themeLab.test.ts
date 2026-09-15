import { describe, expect, it } from "vitest";
import { themeCandidates, themeTokenNames } from "../../src/ui/theme-lab/themeCandidates";

describe("Theme Lab candidates", () => {
  it("offers only the two approved, consecutively numbered directions", () => {
    expect(themeCandidates).toHaveLength(2);
    expect(themeCandidates.map((candidate) => candidate.id)).toEqual(["exactitude", "monument"]);
    expect(themeCandidates.map((candidate) => candidate.sequence)).toEqual(["01", "02"]);
    expect(themeCandidates.map((candidate) => candidate.name)).toEqual(["绝对刻度", "纪碑留白"]);
  });

  it.each(themeCandidates)("provides complete light and dark tokens for $name", (candidate) => {
    for (const mode of ["light", "dark"] as const) {
      expect(Object.keys(candidate.modes[mode]).sort()).toEqual([...themeTokenNames].sort());
      expect(Object.values(candidate.modes[mode])).toHaveLength(themeTokenNames.length);

      for (const token of Object.values(candidate.modes[mode])) {
        expect(token).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});
