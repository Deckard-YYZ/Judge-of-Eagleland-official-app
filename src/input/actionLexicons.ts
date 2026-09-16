import type { ActionId } from "../shared/action";
import type { AppLocale } from "../shared/locale";

export type ActionLexicon = Readonly<Partial<Record<ActionId, readonly string[]>>>;

/** Recognition aliases are independent of translated presentation text. */
export const actionLexicons = {
  "zh-CN": {
    salute: ["敬礼", "行礼"],
    wave: ["挥手"],
  },
  "en-US": {
    salute: ["salute"],
    wave: ["wave"],
  },
} as const satisfies Readonly<Record<AppLocale, ActionLexicon>>;
