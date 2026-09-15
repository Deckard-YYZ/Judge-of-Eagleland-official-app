import type { UiThemeMode } from "./theme";

export interface ThemeSwitchProps {
  mode: UiThemeMode;
  onChange(mode: UiThemeMode): void;
}

export function ThemeSwitch({ mode, onChange }: ThemeSwitchProps) {
  return (
    <div className="theme-switch" role="group" aria-label="界面主题">
      <button type="button" aria-pressed={mode === "light"} onClick={() => onChange("light")}>
        Light
      </button>
      <button type="button" aria-pressed={mode === "dark"} onClick={() => onChange("dark")}>
        Dark
      </button>
    </div>
  );
}
