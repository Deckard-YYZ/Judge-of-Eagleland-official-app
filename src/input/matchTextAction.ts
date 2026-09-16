import type { ActionId } from "../shared/action";
import type { AppLocale } from "../shared/locale";
import { actionLexicons, type ActionLexicon } from "./actionLexicons";

import type { RecognizedAction } from "../shared/recognizedAction";
export type { RecognizedAction } from "../shared/recognizedAction";

/** Keep separators intact: normalization must never join separate words. */
export function normalizeActionText(text: string, locale: AppLocale): string {
  const normalized = text.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return locale === "en-US" ? normalized.toLowerCase() : normalized;
}

function containsAlias(text: string, alias: string, locale: AppLocale): boolean {
  if (locale === "zh-CN") return text.includes(alias);

  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Unicode boundaries reject embedded matches such as waveform, éwave and wave2.
  return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_])${escaped}(?![\\p{L}\\p{N}\\p{M}_])`, "u").test(
    text,
  );
}

/** Match the whole lexicon, never just the current story's expected action. */
export function matchActionLexicon(
  text: string,
  locale: AppLocale,
  lexicon: ActionLexicon,
): RecognizedAction {
  const normalized = normalizeActionText(text, locale);
  if (!normalized) return { type: "unknown" };

  const matched = new Set<ActionId>();
  for (const [actionId, aliases] of Object.entries(lexicon)) {
    if (
      aliases.some((alias) => {
        const value = normalizeActionText(alias, locale);
        return value.length > 0 && containsAlias(normalized, value, locale);
      })
    ) {
      matched.add(actionId as ActionId);
    }
  }

  // Multiple aliases of one action are valid; multiple actions are ambiguous.
  if (matched.size !== 1) return { type: "unknown" };
  return { type: "known", actionId: [...matched][0] };
}

export function matchTextAction(text: string, locale: AppLocale): RecognizedAction {
  return matchActionLexicon(text, locale, actionLexicons[locale]);
}
