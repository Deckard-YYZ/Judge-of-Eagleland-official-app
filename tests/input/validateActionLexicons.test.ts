import { describe, expect, it } from "vitest";
import { actionLexicons } from "../../src/input/actionLexicons";
import { validateActionLexicons } from "../../src/input/validateActionLexicons";
import { ACTION_IDS } from "../../src/shared/action";

describe("validateActionLexicons", () => {
  it("provides all shipped actions in each supported language", () => {
    expect(validateActionLexicons(actionLexicons, ACTION_IDS)).toEqual([]);
  });

  it("rejects empty aliases, malformed aliases and illegal action IDs", () => {
    expect(
      validateActionLexicons(
        { "en-US": { salute: ["", "　\t", 42], bow: ["bow"], wave: null } },
        [],
        ["en-US"],
      ),
    ).toEqual([
      { code: "EMPTY_ALIAS", locale: "en-US", actionId: "salute" },
      { code: "EMPTY_ALIAS", locale: "en-US", actionId: "salute" },
      { code: "EMPTY_ALIAS", locale: "en-US", actionId: "salute" },
      { code: "INVALID_ACTION_ID", locale: "en-US", actionId: "bow" },
      { code: "INVALID_LEXICON", locale: "en-US", actionId: "wave" },
    ]);
  });

  it("rejects normalized collisions while allowing duplicate aliases for one action", () => {
    const lexicons = { "en-US": { salute: [" salute ", "ＳＡＬＵＴＥ"], wave: ["SALUTE"] } };
    expect(validateActionLexicons(lexicons, ACTION_IDS, ["en-US"])).toEqual([
      { code: "ALIAS_CONFLICT", locale: "en-US", actionId: "wave", alias: "SALUTE" },
      { code: "UNREACHABLE_ACTION", locale: "en-US", actionId: "salute" },
      { code: "UNREACHABLE_ACTION", locale: "en-US", actionId: "wave" },
    ]);
    expect(
      validateActionLexicons(
        { "en-US": { salute: [" salute ", "ＳＡＬＵＴＥ"] } },
        ["salute"],
        ["en-US"],
      ),
    ).toEqual([]);
  });

  it("checks required actions in every release locale, including absent locale dictionaries", () => {
    expect(validateActionLexicons({ "zh-CN": { salute: [] } }, ["salute"])).toEqual([
      { code: "UNREACHABLE_ACTION", locale: "zh-CN", actionId: "salute" },
      { code: "INVALID_LEXICON", locale: "en-US" },
      { code: "UNREACHABLE_ACTION", locale: "en-US", actionId: "salute" },
    ]);
  });

  it("rejects an action whose aliases always collide by containment", () => {
    expect(
      validateActionLexicons({ "zh-CN": { salute: ["敬礼"], wave: ["礼"] } }, ACTION_IDS, [
        "zh-CN",
      ]),
    ).toEqual([{ code: "UNREACHABLE_ACTION", locale: "zh-CN", actionId: "salute" }]);
  });
});
