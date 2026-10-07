// @vitest-environment jsdom
import { StrictMode, useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGameSessionView, type GameSessionView } from "../../src/application/gameSessionView";
import { ChatOverlay } from "../../src/ui/presentation/chat/ChatOverlay";
import { getPresentedNewsId, NewsPanel } from "../../src/ui/presentation/NewsPanel";
import { StoryOverlay } from "../../src/ui/presentation/story/StoryOverlay";
import { AppShell } from "../../src/ui/shell/AppShell";
import { TestI18nProvider } from "./TestI18nProvider";
import {
  mainFlowChoices,
  mainFlowFixture,
  mainFlowSave,
  mainFlowSession,
} from "../fixtures/mainFlow";
import { InMemorySaveRepository } from "../../src/storage/inMemorySaveRepository";
import { SaveRepositoryError } from "../../src/storage/saveRepository";
import { App } from "../../src/ui/App";
import type { ProfileEntry, ProfileEntrySnapshot } from "../../src/application/profileEntry";

beforeEach(() => {
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    get: () => window.innerWidth,
  });
  // jsdom has no top layer. Browser verification covers native modality and hit testing.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
        this.querySelector<HTMLButtonElement>("button")!.focus();
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  Reflect.deleteProperty(document.documentElement, "clientWidth");
});

function Workspace({ view, news = false }: { view: GameSessionView; news?: boolean }) {
  const snapshot = useSyncExternalStore(view.subscribe, view.getSnapshot);
  if (!snapshot.state || !snapshot.content) return <p>Loading</p>;
  const modal =
    snapshot.state.pendingStoryIds.length > 0 || (news && getPresentedNewsId(snapshot) !== null);
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
      >
        {progress.status === "active" && (
          <button onClick={() => void view.dispatch(mainFlowChoices[progress.history.length])}>
            Next case choice
          </button>
        )}
      </AppShell>
      <ChatOverlay session={view} snapshot={snapshot} obscured={modal} />
      {news && <NewsPanel session={view} snapshot={snapshot} />}
      <StoryOverlay
        sessionView={view}
        snapshot={snapshot}
        endingOpen={false}
        onCloseEnding={() => {}}
      />
    </TestI18nProvider>
  );
}
async function setup(saves?: InMemorySaveRepository, news = false, fixture = mainFlowFixture()) {
  const result = await mainFlowSession(saves, fixture);
  const view = createGameSessionView(result.session, result.content);
  await view.setLocale("zh-CN");
  await view.dispatch({ type: "startCase", caseId: "intake" });
  const rendered = render(
    <StrictMode>
      <Workspace view={view} news={news} />
    </StrictMode>,
  );
  return { ...result, view, rendered };
}
const chat = (id: string) => document.querySelector<HTMLElement>(`[data-instance="${id}"]`)!;
const reply = async (id: string, name: string) =>
  act(async () => fireEvent.click(within(chat(id)).getByRole("button", { name })));
const tick = async (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("floating conversations", () => {
  it("leaves cases usable, restores history and retains a retired window for four seconds", async () => {
    vi.useFakeTimers();
    const { view, session } = await setup();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".app-shell")!.hasAttribute("inert")).toBe(false);
    expect(document.querySelector(".app-shell .chat-overlay")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Please continue" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /关闭聊天|收起聊天|打开聊天/ })).toBeNull();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Next case choice" })),
    );
    await reply("a", "Please continue");
    expect(session.getSnapshot().state!.mainFlow!.chats.a.inactivityChoices).toBe(0);
    expect(session.getSnapshot().state!.mainFlow!.chats.b.inactivityChoices).toBe(1);
    await act(async () => {
      await view.reload();
    });
    expect(within(chat("a")).getByRole("log").textContent).toContain("Do you agree?");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Next case choice" })),
    );
    expect(Object.keys(session.getSnapshot().state!.mainFlow!.chats)).toEqual(["a"]);
    expect(within(chat("b")).getByText("联络已结束。")).toBeTruthy();
    expect(within(chat("b")).queryByRole("button", { name: "Please continue" })).toBeNull();
    expect(within(chat("b")).getByRole("log").textContent).not.toContain("Goodbye");
    await tick(3999);
    expect(chat("b")).toBeTruthy();
    await tick(1);
    expect(chat("b")).toBeNull();
    expect(chat("a")).toBeTruthy();
  });

  it("shows the committed last reply and terminal message; locale changes do not restart the exit delay", async () => {
    vi.useFakeTimers();
    const { view } = await setup();
    await reply("a", "Please continue");
    await reply("a", "Yes");
    const transcript = within(chat("a")).getByRole("log").textContent!;
    expect(transcript).toContain("Please continue");
    expect(transcript).toContain("Yes");
    expect(transcript).toContain("Goodbye");
    expect(chat("c")).toBeTruthy();
    await tick(2000);
    await act(async () => {
      await view.setLocale("en-US");
    });
    await tick(1999);
    expect(chat("a")).toBeTruthy();
    await tick(1);
    expect(chat("a")).toBeNull();
  });

  it("counts only visible farewell time and never replays saved results after remount", async () => {
    vi.useFakeTimers();
    const { view, rendered } = await setup();
    await reply("a", "Please continue");
    await reply("a", "Yes");
    await tick(1000);
    rendered.rerender(
      <StrictMode>
        <Workspace view={view} news />
      </StrictMode>,
    );
    await tick(6000);
    expect(chat("a")).toBeTruthy();
    rendered.rerender(
      <StrictMode>
        <Workspace view={view} />
      </StrictMode>,
    );
    await tick(2999);
    expect(chat("a")).toBeTruthy();
    await tick(1);
    expect(chat("a")).toBeNull();
    rendered.unmount();
    render(<Workspace view={view} />);
    expect(chat("a")).toBeNull();
    expect(chat("b")).toBeTruthy();
  });

  it("keeps the transcript and displays the save failure before allowing a retry", async () => {
    const saves = new InMemorySaveRepository([mainFlowSave()]);
    const { session } = await setup(saves);
    await reply("a", "Please continue");
    vi.spyOn(saves, "commit").mockRejectedValueOnce(
      new SaveRepositoryError("INVALID_SAVE", "injected"),
    );
    await reply("a", "Yes");
    expect(session.getSnapshot().state!.mainFlow!.chats.a.currentNodeId).toBe("question");
    expect(within(chat("a")).getByRole("log").textContent).not.toContain("Goodbye");
    expect(within(chat("a")).getByRole("alert").textContent).not.toBe("");
    await reply("a", "Yes");
    expect(within(chat("a")).getByRole("log").textContent).toContain("Goodbye");
    expect(within(chat("a")).queryByRole("alert")).toBeNull();
  });

  it("scrolls new messages to the end and supports keyboard movement without changing progress", async () => {
    const { session } = await setup();
    const log = within(chat("a")).getByRole("log");
    Object.defineProperty(log, "scrollHeight", { value: 1200, configurable: true });
    log.scrollTop = 10;
    await reply("a", "Please continue");
    expect(log.scrollTop).toBe(1200);
    const before = session.getSnapshot().envelope!.revision;
    vi.spyOn(chat("a"), "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 100,
      width: 368,
      height: 512,
    } as DOMRect);
    fireEvent.keyDown(within(chat("a")).getByRole("button", { name: /移动与/ }), {
      key: "ArrowRight",
    });
    expect(chat("a").style.left).toBe("120px");
    expect(session.getSnapshot().envelope!.revision).toBe(before);
  });

  it("drags with pointer capture, constrains position on resize, and keeps parallel windows independent", async () => {
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    const { session } = await setup();
    const windowA = chat("a");
    vi.spyOn(windowA, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          left: parseFloat(windowA.style.left),
          top: parseFloat(windowA.style.top),
          width: 368,
          height: 512,
        }) as DOMRect,
    );
    const handle = within(windowA).getByRole("button", { name: /移动与/ });
    handle.setPointerCapture = vi.fn();
    const otherPosition = chat("b").style.cssText;
    const left = parseFloat(windowA.style.left),
      top = parseFloat(windowA.style.top);
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      button: 0,
      clientX: left + 12,
      clientY: top + 10,
    });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 212, clientY: 130 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
    expect(windowA.style.left).toBe("200px");
    expect(windowA.style.top).toBe("120px");
    expect(chat("b").style.cssText).toBe(otherPosition);
    vi.stubGlobal("innerWidth", 420);
    fireEvent(window, new Event("resize"));
    expect(windowA.style.left).toBe("44px");
    expect(session.getSnapshot().state!.mainFlow!.chats.a.history).toEqual([]);
  });
});

describe("news top layer", () => {
  it("opens without marking read, closes into the required action, and leaves no read tab", async () => {
    const { session } = await setup(undefined, true);
    const dialog = screen.getByRole("dialog", { name: "News" });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(document.querySelector(".app-shell .news-overlay")).toBeNull();
    fireEvent.click(within(dialog).getByText("Read the news"));
    expect(session.getSnapshot().state!.pendingStoryIds).toEqual([]);
    expect(session.getSnapshot().state!.mainFlow!.readNewsIds).toEqual([]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "关闭新闻" })));
    expect(session.getSnapshot().state!.mainFlow!.readNewsIds).toEqual(["notice"]);
    expect(screen.queryByRole("dialog", { name: "News" })).toBeNull();
    const action = screen.getByRole("dialog");
    expect(within(action).queryByRole("button", { name: /退出教程/ })).toBeNull();
    expect(document.querySelector(".app-shell")!.hasAttribute("inert")).toBe(true);
    expect(document.querySelector("details")).toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("outside click only acknowledges the news and keeps it visible while saving", async () => {
    const fixture = mainFlowFixture();
    fixture.game.mainFlow!.news.notice = {};
    const saves = new InMemorySaveRepository([mainFlowSave(fixture.game)]);
    const { session } = await setup(saves, true, fixture);
    const commit = saves.commit.bind(saves);
    let release!: () => void;
    vi.spyOn(saves, "commit").mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return commit(...args);
    });
    const dialog = screen.getByRole("dialog", { name: "News" });
    fireEvent.click(dialog);
    fireEvent.click(dialog);
    expect(saves.commit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "关闭新闻" }).disabled).toBe(true);
    expect(session.getSnapshot().state!.mainFlow!.readNewsIds).toEqual([]);
    await act(async () => release());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(session.getSnapshot().state!.cases.intake.status).toBe("active");
    expect(session.getSnapshot().state!.mainFlow!.chats.a.inactivityChoices).toBe(0);
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps failed news open with an error and lets Escape retry the same reading command", async () => {
    const saves = new InMemorySaveRepository([mainFlowSave()]);
    const { session } = await setup(saves, true);
    vi.spyOn(saves, "commit").mockRejectedValueOnce(
      new SaveRepositoryError("INVALID_SAVE", "injected"),
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "关闭新闻" })));
    expect(screen.getByRole("alert").textContent).not.toBe("");
    expect(session.getSnapshot().state!.mainFlow!.readNewsIds).toEqual([]);
    expect(session.getSnapshot().state!.pendingStoryIds).toEqual([]);
    await act(async () =>
      fireEvent(
        screen.getByRole("dialog", { name: "News" }),
        new Event("cancel", { cancelable: true }),
      ),
    );
    expect(session.getSnapshot().state!.mainFlow!.readNewsIds).toEqual(["notice"]);
  });

  it("presents published news in order and waits for required actions before the next bulletin", async () => {
    const fixture = mainFlowFixture();
    fixture.game.mainFlow!.news.second = {};
    fixture.game.mainFlow!.nodes.start.onEnter.push({ type: "publishNews", newsId: "second" });
    for (const copy of Object.values(fixture.localizations))
      copy.mainFlow!.news.second = {
        title: "Second bulletin",
        blocks: [{ type: "paragraph", text: "Second article" }],
      };
    const { view } = await setup(undefined, true, fixture);
    expect(screen.queryByRole("dialog", { name: "Second bulletin" })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "关闭新闻" })));
    expect(screen.queryByRole("dialog", { name: "Second bulletin" })).toBeNull();
    const storyId = view.getSnapshot().state!.pendingStoryIds[0];
    const step = view
      .getSnapshot()
      .content!.stories[storyId].steps.find((step) => step.type === "actionInput")!;
    await act(async () => {
      await view.dispatch({
        type: "submitStoryInput",
        storyId,
        stepId: step.id,
        actionId: "salute",
      });
      await view.dispatch({ type: "completeStory", storyId });
    });
    expect(screen.getByRole("dialog", { name: "Second bulletin" })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "关闭新闻" })));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(view.getSnapshot().state!.mainFlow!.readNewsIds).toEqual(["notice", "second"]);
  });

  it("composes through the real App in debug without mounting the overlays in ordinary mode", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await mainFlowSession();
    const view = createGameSessionView(result.session, result.content);
    await view.setLocale("zh-CN");
    const profile = { profileId: "main-profile", displayName: "Judge" };
    const snapshot: ProfileEntrySnapshot = { status: "ready", profiles: [profile], error: null };
    const entered = async () => ({ ok: true as const, profile, session: view });
    const entry: ProfileEntry = {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      enter: entered,
      register: entered,
    };
    const rendered = render(
      <StrictMode>
        <App profileEntry={entry} mainFlowPreview />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole("button", { name: "选择档案员 Judge" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "登录" })));
    expect(screen.getByRole("dialog", { name: "News" })).toBeTruthy();
    expect(document.querySelector(".app-shell")!.hasAttribute("inert")).toBe(true);
    rendered.unmount();
    render(<App profileEntry={entry} />);
    fireEvent.click(screen.getByRole("button", { name: "选择档案员 Judge" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "登录" })));
    expect(document.querySelector(".chat-overlay")).toBeNull();
    expect(document.querySelector(".news-overlay")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });
});
