// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoProfileEntry } from "../../src/app/demoProfiles";
import { App } from "../../src/ui/App";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});

describe("App mock workspace flow", () => {
  it("applies and persists the official light and dark themes", async () => {
    const user = userEvent.setup();
    render(<App profileEntry={createDemoProfileEntry()} />);

    expect(document.documentElement.dataset.theme).toBe("light");
    await user.click(screen.getByRole("button", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("judge-of-eagleland.ui-theme")).toBe("dark");

    await user.click(screen.getByRole("button", { name: "打开档案" }));
    expect(screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("moves from Profile through both cases and returns from the ending to read-only history", async () => {
    const user = userEvent.setup();
    render(<App profileEntry={createDemoProfileEntry()} />);

    await user.click(screen.getByRole("button", { name: "打开档案" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "第 001 号：夜间档案室事件" }),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "开始案件" }));
    expect(
      await screen.findByRole("heading", { level: 2, name: "你如何评价现有材料？" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /查看.*附注/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: /确认违规，继续确定处理方式/ }));
    expect(
      await screen.findByRole("heading", { level: 2, name: "确定最终处理方式。" }),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /给予书面警告/ }));
    let dialog = await screen.findByRole("dialog", { name: "重要剧情" });
    expect(within(dialog).getByRole("heading", { name: "档案室流程调整" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "完成剧情" }));

    const secondCase = await screen.findByRole("button", {
      name: "第 002 号：调阅权限申请，待开始",
    });
    await user.click(secondCase);
    await user.click(screen.getByRole("button", { name: "开始案件" }));
    await user.click(screen.getByRole("button", { name: /要求补充复核后再调阅/ }));

    dialog = await screen.findByRole("dialog", { name: "重要剧情" });
    expect(within(dialog).getByRole("heading", { name: "平衡的裁定" })).toBeTruthy();
    expect(within(dialog).getByText("终局影像暂时无法播放，但案件在克制中告一段落。")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "继续" }));
    await user.click(within(dialog).getByRole("button", { name: "完成剧情" }));

    expect(await screen.findByRole("heading", { level: 1, name: "平衡的裁定" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "返回已归档案卷" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement?.id).toBe("case-workspace"));
    expect(screen.getByRole("heading", { level: 2, name: "裁定已经归档" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /已处理文档/ }));
    await user.click(screen.getByRole("button", { name: "第 001 号：夜间档案室事件，已结案" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "第 001 号：夜间档案室事件" }),
    ).toBeTruthy();
    expect(screen.getByText("给予书面警告，并要求完成内部流程培训。")).toBeTruthy();

    // Exiting clears only App's active UI reference. Re-entering the same
    // in-memory profile reloads the ended save and presents its ending again.
    await user.click(screen.getByRole("button", { name: "退出档案" }));
    expect(await screen.findByRole("heading", { name: "进入本地档案" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "打开档案" }));
    expect(await screen.findByRole("heading", { level: 1, name: "平衡的裁定" })).toBeTruthy();
  }, 15_000);
});
