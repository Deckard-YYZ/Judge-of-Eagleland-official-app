export type UiThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "judge-of-eagleland.ui-theme";

function isThemeMode(value: string | null): value is UiThemeMode {
  return value === "light" || value === "dark";
}

export function readInitialThemeMode(): UiThemeMode {
  try {
    const storedMode = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeMode(storedMode)) {
      return storedMode;
    }
  } catch {
    // Storage can be unavailable in restricted WebViews; theme selection must still work in memory.
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyThemeMode(mode: UiThemeMode): void {
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Persistence is optional; never block the local game when storage is unavailable.
  }
}
