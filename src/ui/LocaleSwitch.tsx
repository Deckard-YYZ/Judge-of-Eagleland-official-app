import { useI18n } from "./i18n";

export function LocaleSwitch() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="locale-switch" role="group" aria-label={t("locale.label")}>
      <button
        type="button"
        aria-pressed={locale === "zh-CN"}
        aria-label={t("locale.zhLabel")}
        title={t("locale.zhLabel")}
        onClick={() => setLocale("zh-CN")}
      >
        {t("locale.zhShort")}
      </button>
      <button
        type="button"
        aria-pressed={locale === "en-US"}
        aria-label={t("locale.enLabel")}
        title={t("locale.enLabel")}
        onClick={() => setLocale("en-US")}
      >
        {t("locale.enShort")}
      </button>
    </div>
  );
}
