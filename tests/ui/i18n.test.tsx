// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  DEFAULT_LOCALE,
  I18nProvider,
  LOCALE_STORAGE_KEY,
  MESSAGE_CATALOGS,
  SUPPORTED_LOCALES,
  createTranslator,
  formatDate,
  formatNumber,
  parseAppLocale,
  persistLocale,
  readStoredLocale,
  resolveAppLocale,
  useI18n,
  type LocaleStorage,
  type MessageKey,
} from "../../src/ui/i18n";
import { AnnotationPopover } from "../../src/ui/case/AnnotationPopover";
import { LocaleSwitch } from "../../src/ui/LocaleSwitch";

class MemoryLocaleStorage implements LocaleStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.lang = "";
});

describe("application locale", () => {
  it("parses supported values and falls back predictably", () => {
    expect(SUPPORTED_LOCALES).toEqual(["zh-CN", "en-US"]);
    expect(DEFAULT_LOCALE).toBe("zh-CN");
    expect(parseAppLocale("EN_us")).toBe("en-US");
    expect(parseAppLocale("fr-FR")).toBeNull();
    expect(resolveAppLocale(["fr-FR", "en-GB"])).toBe("en-US");
    expect(resolveAppLocale(["not-a-locale"])).toBe(DEFAULT_LOCALE);
  });

  it("reads and persists local preference without making storage mandatory", () => {
    const storage = new MemoryLocaleStorage();
    expect(readStoredLocale(storage)).toBeNull();
    expect(persistLocale(storage, "en-US")).toBe(true);
    expect(storage.values.get(LOCALE_STORAGE_KEY)).toBe("en-US");
    expect(readStoredLocale(storage)).toBe("en-US");

    storage.values.set(LOCALE_STORAGE_KEY, "invalid");
    expect(readStoredLocale(storage)).toBeNull();
    expect(persistLocale(null, "zh-CN")).toBe(false);

    const blockedStorage: LocaleStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredLocale(blockedStorage)).toBeNull();
    expect(persistLocale(blockedStorage, "zh-CN")).toBe(false);
  });
});

describe("typed message catalogs", () => {
  it("uses default keys, interpolates named values and exposes missing data", () => {
    expectTypeOf<"profile.entryTitle">().toMatchTypeOf<MessageKey>();
    expect(Object.keys(MESSAGE_CATALOGS["en-US"])).toEqual(Object.keys(MESSAGE_CATALOGS["zh-CN"]));

    const t = createTranslator("en-US");
    expect(t("profile.entryTitle")).toBe("Enter local archive");
    expect(t("profile.selectAria", { displayName: "Morgan" })).toBe("Select profile Morgan");

    const unsafeTranslate = t as (
      key: MessageKey,
      parameters?: Readonly<Record<string, string>>,
    ) => string;
    expect(() => unsafeTranslate("profile.selectAria")).toThrow(/Missing parameter "displayName"/);

    if (false) {
      // @ts-expect-error Message keys are closed over the default catalog.
      t("arbitrary.runtime.key");
      // @ts-expect-error Named interpolation values are required by the default message.
      t("profile.selectAria");
    }
  });

  it("throws for missing development translations and can explicitly fall back", () => {
    const catalogs = { "en-US": {} };
    expect(() =>
      createTranslator("en-US", { catalogs, missingTranslation: "throw" })("profile.entryTitle"),
    ).toThrow(/Missing en-US translation/);
    expect(
      createTranslator("en-US", { catalogs, missingTranslation: "fallback" })("profile.entryTitle"),
    ).toBe("进入本地档案");
  });
});

describe("I18nProvider", () => {
  it("keeps locale visible inside a React portal and persists changes", () => {
    const storage = new MemoryLocaleStorage();
    storage.setItem(LOCALE_STORAGE_KEY, "en-US");

    function PortalProbe() {
      const { locale, setLocale, t } = useI18n();
      return (
        <>
          <button type="button" onClick={() => setLocale("zh-CN")}>
            中文
          </button>
          {createPortal(
            <output aria-label="portal-locale">
              {locale}: {t("profile.entryTitle")}
            </output>,
            document.body,
          )}
        </>
      );
    }

    render(
      <I18nProvider storage={storage} preferredLocales={["zh-CN"]}>
        <PortalProbe />
      </I18nProvider>,
    );

    expect(screen.getByLabelText("portal-locale").textContent).toBe("en-US: Enter local archive");
    expect(document.documentElement.lang).toBe("en-US");

    act(() => screen.getByRole("button", { name: "中文" }).click());
    expect(screen.getByLabelText("portal-locale").textContent).toBe("zh-CN: 进入本地档案");
    expect(storage.values.get(LOCALE_STORAGE_KEY)).toBe("zh-CN");
  });

  it("rejects hook usage outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function InvalidProbe() {
      useI18n();
      return null;
    }

    expect(() => render(<InvalidProbe />)).toThrow(/within I18nProvider/);
  });

  it("updates an open annotation portal and its accessible labels immediately", () => {
    class TestResizeObserver {
      observe() {}
      disconnect() {}
    }

    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: TestResizeObserver,
    });
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const onDismiss = vi.fn();

    render(
      <I18nProvider storage={null} initialLocale="zh-CN">
        <LocaleSwitch />
        <AnnotationPopover
          id="localized-annotation"
          annotation={{ body: [] }}
          anchorElement={anchor}
          onDismiss={onDismiss}
        />
      </I18nProvider>,
    );

    expect(document.getElementById("localized-annotation")?.getAttribute("role")).toBe("tooltip");
    expect(screen.getByText("选项附注")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "关闭选项附注" })).toBeNull();

    act(() => screen.getByRole("button", { name: "切换为英语" }).click());
    expect(screen.getByText("Option note")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close option note" })).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();

    anchor.remove();
  });
});

describe("Intl helpers", () => {
  it("formats numbers and dates with the requested typed locale", () => {
    const date = Date.UTC(2024, 0, 2, 12);
    const dateOptions = { dateStyle: "medium", timeZone: "UTC" } as const;
    const numberOptions = { minimumFractionDigits: 1 } as const;

    expect(formatNumber("en-US", 1234.5, numberOptions)).toBe(
      new Intl.NumberFormat("en-US", numberOptions).format(1234.5),
    );
    expect(formatDate("zh-CN", date, dateOptions)).toBe(
      new Intl.DateTimeFormat("zh-CN", dateOptions).format(date),
    );
  });
});
