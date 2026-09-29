// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoSession } from "../../src/app/demoSession";
import {
  createGameSessionView,
  type GameSessionViewSnapshot,
} from "../../src/application/gameSessionView";
import { CaseWorkspace } from "../../src/ui/case/CaseWorkspace";
import { TestI18nProvider } from "./TestI18nProvider";

async function createPendingAndResolvedSnapshot(): Promise<GameSessionViewSnapshot> {
  const demo = createDemoSession();
  const view = createGameSessionView(demo.session, demo.contentRepository);
  await demo.reload();
  await view.setLocale("zh-CN");
  await view.dispatch({
    type: "submitStoryInput",
    storyId: "tutorial_voice_order",
    stepId: "order",
    actionId: "salute",
  });
  await view.dispatch({ type: "completeStory", storyId: "tutorial_voice_order" });
  await view.dispatch({ type: "startCase", caseId: "case_001" });
  await view.dispatch({
    type: "chooseOption",
    caseId: "case_001",
    nodeId: "assessment",
    choiceId: "insufficient_evidence",
  });
  return view.getSnapshot();
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CaseWorkspace document handoff", () => {
  it("shows the empty guide before a document is selected", async () => {
    const snapshot = await createPendingAndResolvedSnapshot();
    render(
      <CaseWorkspace
        snapshot={{ ...snapshot, selectedCaseId: null }}
        dispatch={vi.fn()}
        reload={vi.fn()}
      />,
      {
        wrapper: TestI18nProvider,
      },
    );

    expect(screen.getByRole("heading", { level: 1, name: "等待调取案卷" })).toBeTruthy();
    expect(screen.getByText(/选择一份未处理或已处理文档/)).toBeTruthy();
  });

  it("presents pending and archived documents on the next turn without artificial delay", async () => {
    const snapshot = await createPendingAndResolvedSnapshot();
    vi.useFakeTimers();
    const { rerender } = render(
      <CaseWorkspace
        snapshot={{ ...snapshot, selectedCaseId: "case_002" }}
        dispatch={vi.fn()}
        reload={vi.fn()}
      />,
      { wrapper: TestI18nProvider },
    );

    expect(screen.getByRole("status", { name: "" }).getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("heading", { name: "第 002 号：调阅权限申请" })).toBeNull();
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByRole("heading", { name: "第 002 号：调阅权限申请" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "开始案件" })).toBeNull();
    expect(screen.getByText("滚动至此以准备裁定选项")).toBeTruthy();

    rerender(
      <CaseWorkspace
        snapshot={{ ...snapshot, selectedCaseId: "case_001" }}
        dispatch={vi.fn()}
        reload={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "正在调取案卷" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "裁定已经归档" })).toBeNull();
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByRole("heading", { name: "第 001 号：夜间档案室事件" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "裁定已经归档" })).toBeTruthy();
  });

  it("does not let an older timer flash a stale document after rapid switching", async () => {
    const snapshot = await createPendingAndResolvedSnapshot();
    vi.useFakeTimers();
    const { rerender } = render(
      <CaseWorkspace
        snapshot={{ ...snapshot, selectedCaseId: "case_001" }}
        dispatch={vi.fn()}
        reload={vi.fn()}
        caseOpenDelayMs={1_500}
      />,
      { wrapper: TestI18nProvider },
    );

    act(() => vi.advanceTimersByTime(700));
    rerender(
      <CaseWorkspace
        snapshot={{ ...snapshot, selectedCaseId: "case_002" }}
        dispatch={vi.fn()}
        reload={vi.fn()}
        caseOpenDelayMs={1_500}
      />,
    );
    act(() => vi.advanceTimersByTime(800));

    expect(screen.getByRole("heading", { name: "正在调取案卷" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "第 001 号：夜间档案室事件" })).toBeNull();

    act(() => vi.advanceTimersByTime(700));
    expect(screen.getByRole("heading", { name: "第 002 号：调阅权限申请" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "第 001 号：夜间档案室事件" })).toBeNull();
  });
});

it.each(["needsReload", "error"] as const)(
  "offers identity-free recovery in %s without case selection",
  async (status) => {
    const snapshot = await createPendingAndResolvedSnapshot();
    const reload = vi.fn().mockResolvedValue({ ok: false, code: "SAVE_LOAD_FAILED" });
    render(
      <CaseWorkspace
        snapshot={{
          ...snapshot,
          status,
          selectedCaseId: null,
          error: { code: "RELOAD_REQUIRED", message: "reload" },
        }}
        dispatch={vi.fn()}
        reload={reload}
      />,
      { wrapper: TestI18nProvider },
    );
    fireEvent.click(screen.getByRole("button", { name: "重新载入档案" }));
    expect(reload).toHaveBeenCalledWith();
  },
);

it("rejects an already queued old handoff callback after a newer selection", async () => {
  const snapshot = await createPendingAndResolvedSnapshot();
  vi.useFakeTimers();
  const timer = vi.spyOn(window, "setTimeout");
  const props = { dispatch: vi.fn(), reload: vi.fn() };
  const view = render(
    <CaseWorkspace {...props} snapshot={{ ...snapshot, selectedCaseId: "case_001" }} />,
    { wrapper: TestI18nProvider },
  );
  const staleCallback = timer.mock.calls.find((call) => call[1] === 0)?.[0] as () => void;
  view.rerender(
    <CaseWorkspace {...props} snapshot={{ ...snapshot, selectedCaseId: "case_002" }} />,
  );
  act(() => staleCallback());
  expect(screen.queryByRole("heading", { name: "第 001 号：夜间档案室事件" })).toBeNull();
  act(() => vi.advanceTimersByTime(0));
  expect(screen.getByRole("heading", { name: "第 002 号：调阅权限申请" })).toBeTruthy();
});
