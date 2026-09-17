import { useEffect, useId, useRef, useState } from "react";
import { LocaleSwitch } from "./LocaleSwitch";
import { ThemeSwitch } from "./ThemeSwitch";
import { useI18n } from "./i18n";
import type { UiThemeMode } from "./theme";
import "./interface-settings.css";

export interface InterfaceSettingsProps {
  themeMode: UiThemeMode;
  onThemeChange(mode: UiThemeMode): void;
}

export function InterfaceSettings({ themeMode, onThemeChange }: InterfaceSettingsProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div
      className="interface-settings"
      ref={root}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="interface-settings__trigger"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t("settings.title")}
        title={t("settings.title")}
        onClick={() => setOpen(!open)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M4 7h16M4 17h16M8 4v6M16 14v6" />
        </svg>
      </button>
      {open && (
        <div
          id={panelId}
          className="interface-settings__panel"
          role="group"
          aria-label={t("settings.title")}
        >
          <div className="interface-settings__heading">
            <strong>{t("settings.title")}</strong>
            <button
              type="button"
              aria-label={t("settings.close")}
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              ×
            </button>
          </div>
          <p>{t("theme.label")}</p>
          <ThemeSwitch mode={themeMode} onChange={onThemeChange} />
          <p>{t("locale.label")}</p>
          <LocaleSwitch />
        </div>
      )}
    </div>
  );
}
