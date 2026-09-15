// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoProfileEntry } from "../../src/app/demoProfiles";
import { App } from "../../src/ui/App";

let nextObjectUrl = 1;
const createObjectURL = vi.fn(() => `blob:profile-avatar-${nextObjectUrl++}`);
const revokeObjectURL = vi.fn();

beforeEach(() => {
  nextObjectUrl = 1;
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.lang = "";
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});

describe("App mock workspace flow", () => {
  it("updates active choices, annotation, story, and resolved history without changing the run", async () => {
    const user = userEvent.setup();
    render(
      <App profileEntry={createDemoProfileEntry()} caseOpenDelayMs={0} decisionRevealDelayMs={0} />,
    );

    await user.click(screen.getByRole("button", { name: "选择档案员 演示档案员" }));
    await user.click(screen.getByRole("button", { name: "登录" }));
    await user.click(
      await screen.findByRole("button", { name: "第 001 号：夜间档案室事件，待开始" }),
    );
    await user.click(await screen.findByRole("button", { name: "开始案件" }));
    const chineseChoice = await screen.findByRole("button", { name: /现有材料不足/ });
    fireEvent.focus(chineseChoice);
    let annotation = await screen.findByRole("tooltip");
    expect(within(annotation).getByText("材料限制")).toBeTruthy();

    // click without pointerdown keeps the open portal mounted while locale projection changes.
    fireEvent.click(screen.getByRole("button", { name: "切换为英语" }));
    expect(await screen.findByRole("button", { name: /evidence does not support/ })).toBeTruthy();
    annotation = await screen.findByRole("tooltip");
    expect(within(annotation).getByText("Limits of the record")).toBeTruthy();
    expect(within(annotation).queryByText("材料限制")).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    await user.click(screen.getByRole("button", { name: /evidence does not support/ }));
    let dialog = await screen.findByRole("dialog", { name: "Important story" });
    expect(within(dialog).getByRole("heading", { name: "Archive Procedure Revised" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Switch to Simplified Chinese" }));
    dialog = await screen.findByRole("dialog", { name: "重要剧情" });
    expect(within(dialog).getByRole("heading", { name: "档案室流程调整" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "完成剧情" }));

    expect(await screen.findByText("保留程序违规记录，本次不追加处分。")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "切换为英语" }));
    expect(
      await screen.findByText("Record the procedural breach without additional discipline."),
    ).toBeTruthy();
    expect(screen.queryByText("保留程序违规记录，本次不追加处分。")).toBeNull();
  });

  it("switches and persists the application language before and after sign-in", async () => {
    const user = userEvent.setup();
    const firstRender = render(
      <App profileEntry={createDemoProfileEntry()} caseOpenDelayMs={0} decisionRevealDelayMs={0} />,
    );

    expect(document.documentElement.lang).toBe("zh-CN");
    expect(screen.getByRole("heading", { name: "进入本地档案" })).toBeTruthy();
    expect(screen.queryByText("LOCAL PROFILE")).toBeNull();

    await user.click(screen.getByRole("button", { name: "切换为英语" }));
    expect(document.documentElement.lang).toBe("en-US");
    expect(window.localStorage.getItem("judge-of-eagleland.ui-locale")).toBe("en-US");
    expect(screen.getByRole("heading", { name: "Enter local archive" })).toBeTruthy();
    expect(screen.queryByText("进入本地档案")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Select profile 演示档案员" }));
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Awaiting case selection" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch to Simplified Chinese" })).toBeTruthy();
    expect(screen.queryByText("等待调取案卷")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Switch to Simplified Chinese" }));
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(screen.getByRole("heading", { name: "等待调取案卷" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "切换为英语" }));
    firstRender.unmount();
    render(<App profileEntry={createDemoProfileEntry()} />);
    expect(document.documentElement.lang).toBe("en-US");
    expect(screen.getByRole("heading", { name: "Enter local archive" })).toBeTruthy();
  });

  it("applies and persists the official light and dark themes", async () => {
    const user = userEvent.setup();
    render(
      <App profileEntry={createDemoProfileEntry()} caseOpenDelayMs={0} decisionRevealDelayMs={0} />,
    );

    expect(document.documentElement.dataset.theme).toBe("light");
    await user.click(screen.getByRole("button", { name: "深色" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("judge-of-eagleland.ui-theme")).toBe("dark");

    await user.click(screen.getByRole("button", { name: "选择档案员 演示档案员" }));
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(screen.getByRole("button", { name: "深色" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("moves from Profile through both cases and returns from the ending to read-only history", async () => {
    const user = userEvent.setup();
    render(
      <App profileEntry={createDemoProfileEntry()} caseOpenDelayMs={0} decisionRevealDelayMs={0} />,
    );

    await user.click(screen.getByRole("button", { name: "选择档案员 演示档案员" }));
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByRole("heading", { level: 1, name: "等待调取案卷" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "第 001 号：夜间档案室事件，待开始" }));
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
    await user.click(await screen.findByRole("button", { name: "开始案件" }));
    await user.click(screen.getByRole("button", { name: /要求补充复核后再调阅/ }));

    dialog = await screen.findByRole("dialog", { name: "重要剧情" });
    expect(within(dialog).getByRole("heading", { name: "平衡的裁定" })).toBeTruthy();
    expect(within(dialog).getByText("终局影像暂时无法播放，但案件在克制中告一段落。")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "切换为英语" }));
    dialog = await screen.findByRole("dialog", { name: "Important story" });
    expect(within(dialog).getByRole("heading", { name: "A Balanced Judgment" })).toBeTruthy();
    expect(within(dialog).getByText(/ending video is unavailable/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Switch to Simplified Chinese" }));
    dialog = await screen.findByRole("dialog", { name: "重要剧情" });
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
    await user.click(screen.getByRole("button", { name: "选择档案员 演示档案员" }));
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByRole("heading", { level: 1, name: "平衡的裁定" })).toBeTruthy();
  }, 15_000);

  it("switches registration in place and keeps a local avatar preview for the app lifetime", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <App profileEntry={createDemoProfileEntry()} caseOpenDelayMs={0} decisionRevealDelayMs={0} />,
    );

    await user.click(screen.getByRole("button", { name: "注册" }));
    expect((screen.getByRole("button", { name: "确定" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "返回" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "登录" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByRole("button", { name: "登录" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "注册" }));

    await user.type(screen.getByLabelText("显示名称"), "新档案员");
    const uploadInput = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1];
    expect(uploadInput).toBeDefined();
    await user.upload(uploadInput, new File(["avatar"], "avatar.png", { type: "image/png" }));
    expect(screen.getByRole("img", { name: "新档案头像预览" }).getAttribute("src")).toBe(
      "blob:profile-avatar-1",
    );

    await user.click(screen.getByRole("button", { name: "确定" }));
    expect(await screen.findByRole("heading", { level: 1, name: "等待调取案卷" })).toBeTruthy();
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:profile-avatar-1");

    await user.click(screen.getByRole("button", { name: "退出档案" }));
    const registeredProfile = await screen.findByRole("button", {
      name: "选择档案员 新档案员",
    });
    expect(registeredProfile.querySelector("img")?.getAttribute("src")).toBe(
      "blob:profile-avatar-2",
    );
  });
});
