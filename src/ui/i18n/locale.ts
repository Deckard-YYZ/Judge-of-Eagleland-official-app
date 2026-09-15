import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type AppLocale } from "../../shared/locale";

export { DEFAULT_LOCALE, SUPPORTED_LOCALES, type AppLocale } from "../../shared/locale";
export const LOCALE_STORAGE_KEY = "judge-of-eagleland.ui-locale";

export interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Parses only supported application locales; negotiation belongs to resolveAppLocale. */
export function parseAppLocale(value: unknown): AppLocale | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replaceAll("_", "-").toLowerCase();
  return SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === normalized) ?? null;
}

/** Resolves exact locales first, then a supported language family, then the app default. */
export function resolveAppLocale(candidates: readonly unknown[]): AppLocale {
  for (const candidate of candidates) {
    const exact = parseAppLocale(candidate);
    if (exact) {
      return exact;
    }

    if (typeof candidate === "string") {
      const language = candidate.trim().replaceAll("_", "-").split("-")[0]?.toLowerCase();
      if (language === "zh") {
        return "zh-CN";
      }
      if (language === "en") {
        return "en-US";
      }
    }
  }

  return DEFAULT_LOCALE;
}

export function readStoredLocale(storage: LocaleStorage | null): AppLocale | null {
  if (!storage) {
    return null;
  }

  try {
    return parseAppLocale(storage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    // Restricted WebViews may reject localStorage access; locale remains usable in memory.
    return null;
  }
}

export function persistLocale(storage: LocaleStorage | null, locale: AppLocale): boolean {
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(LOCALE_STORAGE_KEY, locale);
    return true;
  } catch {
    // Persistence is optional and must never block a local session.
    return false;
  }
}
