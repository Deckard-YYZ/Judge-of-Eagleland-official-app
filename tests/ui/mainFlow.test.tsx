// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameSessionView, type GameSessionView } from "../../src/application/gameSessionView";
import { ChatOverlay } from "../../src/ui/presentation/chat/ChatOverlay";
import { NewsPanel } from "../../src/ui/presentation/NewsPanel";
import { StoryOverlay } from "../../src/ui/presentation/story/StoryOverlay";
import { AppShell } from "../../src/ui/shell/AppShell";
import { TestI18nProvider } from "./TestI18nProvider";
import { mainFlowChoices, mainFlowSave, mainFlowSession } from "../fixtures/mainFlow";
import { InMemorySaveRepository } from "../../src/storage/inMemorySaveRepository";
import { SaveRepositoryError } from "../../src/storage/saveRepository";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

function Workspace({ view }: { view: GameSessionView }) {
  const snapshot = useSyncExternalStore(view.subscribe, view.getSnapshot);
  if (!snapshot.state || !snapshot.content) return <p>Loading</p>;
  const modal = snapshot.state!.pendingStoryIds.length > 0;
  const progress = snapshot.state.cases.intake;
  return (
    <TestI18nProvider>
      <AppShell
        profile={{ profileId: "main-profile", displayName: "Judge" }}
        snapshot={snapshot}
        modalActive={modal}
        themeMode="light"
        onThemeChange={() => {}}
        onSelectCase={view.selectCase}
        onExit={() => {}}
        conversations={<ChatOverlay session={view} snapshot={snapshot} />}
      >
        <NewsPanel session={view} snapshot={snapshot} />
        {progress.status === "active" && (
          <button onClick={() => void view.dispatch(mainFlowChoices[progress.history.length])}>
            Next case choice
          </button>
        )}
      </AppShell>
      <StoryOverlay
        sessionView={view}
        snapshot={snapshot}
        endingOpen={false}
        onCloseEnding={() => {}}
      />
    </TestI18nProvider>
  );
}
async function setup(saves?: InMemorySaveRepository) {
  const result = await mainFlowSession(saves);
  const view = createGameSessionView(result.session, result.content);
  await view.setLocale("zh-CN");
  await view.dispatch({ type: "startCase", caseId: "intake" });
  render(<Workspace view={view} />);
  return { ...result, view };
}

describe("parallel chat and news presentation", () => {
  it("leaves the case workspace usable and restores committed transcript and separate counters", async () => {
    const { view, session } = await setup();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".app-shell")!.hasAttribute("inert")).toBe(false);
    expect(screen.getAllByRole("button", { name: "Please continue" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /关闭聊天|收起聊天|打开聊天/ })).toBeNull();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Next case choice" })),
    );
    expect(session.getSnapshot().state!.mainFlow!.chats.a.inactivityChoices).toBe(1);
    await act(async () =>
      fireEvent.click(screen.getAllByRole("button", { name: "Please continue" })[0]),
    );
    expect(session.getSnapshot().state!.mainFlow!.chats.a.inactivityChoices).toBe(0);
    expect(session.getSnapshot().state!.mainFlow!.chats.b.inactivityChoices).toBe(1);
    expect(screen.getAllByRole("log")[0].textContent).toContain("Please continue");
    await act(async () => {
      await view.reload();
    });
    expect(screen.getAllByRole("log")[0].textContent).toContain("Do you agree?");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Next case choice" })),
    );
    expect(Object.keys(session.getSnapshot().state!.mainFlow!.chats)).toEqual(["a"]);
    expect(screen.getAllByRole("log")).toHaveLength(1);
  });

  it("keeps the old replies and transcript when their save fails", async () => {
    const saves = new InMemorySaveRepository([mainFlowSave()]);
    const { session } = await setup(saves);
    vi.spyOn(saves, "commit").mockRejectedValueOnce(
      new SaveRepositoryError("INVALID_SAVE", "injected"),
    );
    await act(async () =>
      fireEvent.click(screen.getAllByRole("button", { name: "Please continue" })[0]),
    );
    expect(session.getSnapshot().state!.mainFlow!.chats.a.history).toEqual([]);
    expect(screen.queryByText("Do you agree?")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Please continue" })).toHaveLength(2);
  });

  it("starts a mandatory action only after reading is committed and never supplies tutorial exit for it", async () => {
    const { session } = await setup();
    fireEvent.click(screen.getByText("News", { selector: "summary" }));
    expect(session.getSnapshot().state!.pendingStoryIds).toEqual([]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "阅读完成" })));
    expect(session.getSnapshot().state!.mainFlow!.readNewsIds).toEqual(["notice"]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /退出教程/ })).toBeNull();
    expect(document.querySelector(".app-shell")!.hasAttribute("inert")).toBe(true);
    expect(screen.queryByRole("button", { name: "阅读完成" })).toBeNull();
  });
});
