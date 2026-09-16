import { ACTION_IDS, type ActionId } from "../shared/action";
import { SUPPORTED_LOCALES, type AppLocale } from "../shared/locale";
import type { ActionLexicon } from "./actionLexicons";
import { matchActionLexicon, normalizeActionText } from "./matchTextAction";

export interface ActionLexiconIssue {
  code:
    | "INVALID_LEXICON"
    | "INVALID_ACTION_ID"
    | "EMPTY_ALIAS"
    | "ALIAS_CONFLICT"
    | "UNREACHABLE_ACTION";
  locale: AppLocale;
  actionId?: string;
  alias?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Build-time capability validation; it has no dependency on content or device state. */
export function validateActionLexicons(
  lexicons: unknown,
  requiredActionIds: readonly ActionId[],
  locales: readonly AppLocale[] = SUPPORTED_LOCALES,
): ActionLexiconIssue[] {
  const issues: ActionLexiconIssue[] = [];
  for (const locale of locales) {
    const raw: unknown = isRecord(lexicons) ? lexicons[locale] : undefined;
    const aliasesByAction: Partial<Record<ActionId, string[]>> = {};
    const owners = new Map<string, string>();

    if (!isRecord(raw)) {
      issues.push({ code: "INVALID_LEXICON", locale });
    } else {
      for (const [actionId, aliases] of Object.entries(raw)) {
        if (!(ACTION_IDS as readonly string[]).includes(actionId)) {
          issues.push({ code: "INVALID_ACTION_ID", locale, actionId });
          continue;
        }
        if (!Array.isArray(aliases)) {
          issues.push({ code: "INVALID_LEXICON", locale, actionId });
          continue;
        }
        const validAliases: string[] = [];
        for (const alias of aliases) {
          if (typeof alias !== "string" || !normalizeActionText(alias, locale)) {
            issues.push({ code: "EMPTY_ALIAS", locale, actionId });
            continue;
          }
          const normalized = normalizeActionText(alias, locale);
          const owner = owners.get(normalized);
          if (owner !== undefined && owner !== actionId) {
            issues.push({ code: "ALIAS_CONFLICT", locale, actionId, alias });
          }
          owners.set(normalized, actionId);
          validAliases.push(alias);
        }
        aliasesByAction[actionId as ActionId] = validAliases;
      }
    }

    const lexicon: ActionLexicon = aliasesByAction;
    for (const actionId of new Set(requiredActionIds)) {
      // Merely having an alias is insufficient if every alias matches another action too.
      const reachable = lexicon[actionId]?.some((alias) => {
        const match = matchActionLexicon(alias, locale, lexicon);
        return match.type === "known" && match.actionId === actionId;
      });
      if (!reachable) issues.push({ code: "UNREACHABLE_ACTION", locale, actionId });
    }
  }
  return issues;
}
