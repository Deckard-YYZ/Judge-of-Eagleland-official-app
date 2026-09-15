import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { formatDate, formatNumber } from "./format";
import {
  DEFAULT_LOCALE,
  persistLocale,
  readStoredLocale,
  resolveAppLocale,
  type AppLocale,
  type LocaleStorage,
} from "./locale";
import { createTranslator, type Translate } from "./translator";

export interface I18nContextValue {
  locale: AppLocale;
  setLocale(locale: AppLocale): void;
  t: Translate;
  formatNumber(value: number | bigint, options?: Intl.NumberFormatOptions): string;
  formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
}

export interface I18nProviderProps {
  children: ReactNode;
  initialLocale?: AppLocale;
  storage?: LocaleStorage | null;
  preferredLocales?: readonly string[];
}

const I18nContext = createContext<I18nContextValue | null>(null);

const getBrowserStorage = (): LocaleStorage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export function I18nProvider({
  children,
  initialLocale,
  storage,
  preferredLocales,
}: I18nProviderProps) {
  const localeStorage = useMemo(
    () => (storage === undefined ? getBrowserStorage() : storage),
    [storage],
  );
  const [locale, setLocale] = useState<AppLocale>(() => {
    if (initialLocale) {
      return initialLocale;
    }

    return (
      readStoredLocale(localeStorage) ?? resolveAppLocale(preferredLocales ?? [DEFAULT_LOCALE])
    );
  });

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    persistLocale(localeStorage, locale);
  }, [locale, localeStorage]);

  const t = useMemo(() => createTranslator(locale), [locale]);
  const setAppLocale = useCallback((nextLocale: AppLocale) => setLocale(nextLocale), []);
  const formatLocalizedNumber = useCallback(
    (value: number | bigint, options?: Intl.NumberFormatOptions) =>
      formatNumber(locale, value, options),
    [locale],
  );
  const formatLocalizedDate = useCallback(
    (value: Date | number, options?: Intl.DateTimeFormatOptions) =>
      formatDate(locale, value, options),
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale: setAppLocale,
      t,
      formatNumber: formatLocalizedNumber,
      formatDate: formatLocalizedDate,
    }),
    [formatLocalizedDate, formatLocalizedNumber, locale, setAppLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider.");
  }
  return context;
}
