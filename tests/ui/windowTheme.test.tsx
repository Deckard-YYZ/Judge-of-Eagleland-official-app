// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createDemoProfileEntry } from "../../src/app/demoProfiles";
import { App } from "../../src/ui/App";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

it("notifies composition of the restored startup theme and subsequent setting changes", async () => {
  window.localStorage.setItem("judge-of-eagleland.ui-theme", "dark");
  const onThemeApplied = vi.fn();
  const user = userEvent.setup();
  render(<App profileEntry={createDemoProfileEntry()} onThemeApplied={onThemeApplied} />);
  expect(onThemeApplied).toHaveBeenLastCalledWith("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
  await user.click(screen.getByRole("button", { name: "界面设置" }));
  await user.click(screen.getByRole("button", { name: "浅色" }));
  expect(onThemeApplied).toHaveBeenLastCalledWith("light");
  expect(document.documentElement.dataset.theme).toBe("light");
});
