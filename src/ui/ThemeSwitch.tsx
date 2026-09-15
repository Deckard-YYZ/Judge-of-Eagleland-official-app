import type { UiThemeMode } from "./theme";
import { useI18n } from "./i18n";

export interface ThemeSwitchProps {
  mode: UiThemeMode;
  onChange(mode: UiThemeMode): void;
}

export function ThemeSwitch({ mode, onChange }: ThemeSwitchProps) {
  const { t } = useI18n();

  return (
    <div className="theme-switch" role="group" aria-label={t("theme.label")}>
      <button type="button" aria-pressed={mode === "light"} onClick={() => onChange("light")}>
        {t("theme.light")}
      </button>
      <button type="button" aria-pressed={mode === "dark"} onClick={() => onChange("dark")}>
        {t("theme.dark")}
      </button>
    </div>
  );
}
