// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { InterfaceSettings } from "../../src/ui/InterfaceSettings";
import { I18nProvider } from "../../src/ui/i18n";

afterEach(cleanup);

it("keeps settings inside the active surface and consumes Escape before a parent dialog", async () => {
  const user = userEvent.setup();
  const onParentKey = vi.fn();
  const onThemeChange = vi.fn();
  render(
    <I18nProvider initialLocale="zh-CN" storage={null}>
      <div onKeyDown={onParentKey}>
        <InterfaceSettings themeMode="light" onThemeChange={onThemeChange} />
        <button type="button">Outside</button>
      </div>
    </I18nProvider>,
  );
  const trigger = screen.getByRole("button", { name: "界面设置" });
  expect(screen.queryByRole("button", { name: "深色" })).toBeNull();
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "深色" }));
  expect(onThemeChange).toHaveBeenCalledWith("dark");
  await user.click(screen.getByRole("button", { name: "切换为英语" }));
  expect(screen.getByRole("button", { name: "Close settings" })).toBeTruthy();
  onParentKey.mockClear();
  await user.keyboard("{Escape}");
  expect(onParentKey).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("button", { name: "Dark" })).toBeNull();
  await user.click(trigger);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});
