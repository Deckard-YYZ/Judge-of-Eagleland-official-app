/** Locales supported by both the application chrome and versioned content packages. */
export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "zh-CN";
