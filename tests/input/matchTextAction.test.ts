import { describe, expect, it } from "vitest";
import { matchActionLexicon, matchTextAction } from "../../src/input/matchTextAction";
import type { AppLocale } from "../../src/shared/locale";

describe("matchTextAction", () => {
  it.each<[AppLocale, string, string]>([
    ["zh-CN", "敬礼", "salute"],
    ["zh-CN", "我现在行礼", "salute"],
    ["zh-CN", "挥手", "wave"],
    ["zh-CN", "敬礼，然后行礼", "salute"],
    ["zh-CN", "不要敬礼", "salute"],
    ["en-US", "SALUTE!", "salute"],
    ["en-US", "I salute you.", "salute"],
    ["en-US", "do not salute", "salute"],
    ["en-US", "　ＷＡＶＥ！　", "wave"],
    ["en-US", "wave, wave", "wave"],
  ])("recognizes literal aliases in %s: %s", (locale, text, actionId) => {
    expect(matchTextAction(text, locale)).toEqual({ type: "known", actionId });
  });

  it.each<[AppLocale, string]>([
    ["zh-CN", "敬礼还是挥手"],
    ["en-US", "salute or wave"],
    ["en-US", "wave or salute"],
    ["zh-CN", "salute"],
    ["en-US", "敬礼"],
    ["zh-CN", "敬 禮"],
    ["zh-CN", "敬 礼"],
    ["en-US", "waveform"],
    ["en-US", "waves"],
    ["en-US", "éwave"],
    ["en-US", "wave中"],
    ["en-US", "wave2"],
    ["en-US", "2wave"],
    ["en-US", "wave\u0301"],
    ["en-US", "wave_test"],
    ["en-US", "sa lute"],
    ["zh-CN", "\t\n　"],
    ["en-US", ""],
  ])("rejects unknown or ambiguous input in %s: %s", (locale, text) => {
    expect(matchTextAction(text, locale)).toEqual({ type: "unknown" });
  });

  it("normalizes both phrase aliases and input without deleting separators", () => {
    const lexicon = { salute: ["  GIVE　 A SALUTE  "] };
    expect(matchActionLexicon("please give\t a\n salute!", "en-US", lexicon)).toEqual({
      type: "known",
      actionId: "salute",
    });
    expect(matchActionLexicon("give-a-salute", "en-US", lexicon)).toEqual({ type: "unknown" });
  });

  it("treats aliases as literal strings and refuses overlapping multi-action matches", () => {
    expect(matchActionLexicon("a+b", "en-US", { salute: ["a+b"] })).toEqual({
      type: "known",
      actionId: "salute",
    });
    expect(matchActionLexicon("aaab", "en-US", { salute: ["a+b"] })).toEqual({ type: "unknown" });
    for (const lexicon of [
      { salute: ["敬礼"], wave: ["礼"] },
      { wave: ["礼"], salute: ["敬礼"] },
    ]) {
      expect(matchActionLexicon("敬礼", "zh-CN", lexicon)).toEqual({ type: "unknown" });
    }
  });
});
