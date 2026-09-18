// @vitest-environment jsdom
import { StrictMode, useEffect, useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTION_INPUT_GAME_CONTENT,
  ACTION_INPUT_LOCALIZATIONS,
} from "../../src/app/actionInputContent";
import { createDemoSave } from "../../src/app/demoSession";
import { createGameSession } from "../../src/application/gameSession";
import { createGameSessionView, type GameSessionView } from "../../src/application/gameSessionView";
import { FakeSplitContentRepository } from "../../src/content/repository";
import { transition } from "../../src/game/transition";
import { InMemorySaveRepository } from "../../src/storage/inMemorySaveRepository";
import type {
  NarrationRequest,
  NarrationOutcome,
  NarrationService,
} from "../../src/shared/narration";
import { I18nProvider, useI18n } from "../../src/ui/i18n";
import { StoryOverlay } from "../../src/ui/presentation/story/StoryOverlay";
import {
  NarrationProvider,
  useNarration,
  NARRATION_PREFERENCE_KEY,
} from "../../src/ui/narration/NarrationProvider";
import { NarrationControls } from "../../src/ui/narration/NarrationControls";

function fake() {
  const requests: {
    request: NarrationRequest;
    resolve(value: NarrationOutcome): void;
    reject(error: unknown): void;
  }[] = [];
  const service: NarrationService = {
    available: true,
    stop: vi.fn(async () => {}),
    speak: vi.fn(
      (request) =>
        new Promise<NarrationOutcome>((resolve, reject) => {
          requests.push({ request, resolve, reject });
          request.onPhase?.("playing");
        }),
    ),
  };
  return { service, requests };
}
async function setup() {
  const now = "2026-09-18T00:00:00.000Z";
  const saves = new InMemorySaveRepository([
    createDemoSave("p", "s", ACTION_INPUT_GAME_CONTENT, now),
  ]);
  const content = new FakeSplitContentRepository([
    { gameContent: ACTION_INPUT_GAME_CONTENT, localizations: ACTION_INPUT_LOCALIZATIONS },
  ]);
  const session = createGameSession({
    saveRepository: saves,
    contentRepository: content,
    transition,
    clock: () => now,
  });
  const view = createGameSessionView(session, content);
  await session.load("s", "p");
  await view.setLocale("zh-CN");
  return { view, saves, content };
}
function Presentation({ view }: { view: GameSessionView }) {
  const snapshot = useSyncExternalStore(view.subscribe, view.getSnapshot);
  const { locale } = useI18n();
  const narration = useNarration();
  useEffect(() => {
    void view.setLocale(locale);
  }, [view, locale]);
  return (
    <>
      <button onClick={() => narration.setEnabled(!narration.enabled)}>toggle narration</button>
      <StoryOverlay
        sessionView={view}
        snapshot={snapshot}
        endingOpen={false}
        onCloseEnding={() => {}}
      />
    </>
  );
}
function ui(view: GameSessionView, service: NarrationService) {
  return (
    <StrictMode>
      <I18nProvider initialLocale="zh-CN" storage={null}>
        <NarrationProvider service={service}>
          <Presentation view={view} />
        </NarrationProvider>
      </I18nProvider>
    </StrictMode>
  );
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("narration with real story sessions", () => {
  it("reports a failed stop without changing facts and isolates it from later requests", async () => {
    const { view } = await setup();
    const f = fake();
    let rejectStop!: (error: Error) => void;
    vi.mocked(f.service.stop).mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          rejectStop = reject;
        }),
    );
    render(ui(view, f.service));
    await waitFor(() => expect(f.requests).toHaveLength(1));
    const revision = view.getSnapshot().envelope!.revision;
    fireEvent.click(screen.getByRole("button", { name: "停止朗读" }));
    await act(async () => rejectStop(new Error("stop failed")));
    expect(screen.getByText("朗读失败，可以重播或继续阅读文字。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重播朗读" }));
    await waitFor(() => expect(f.requests).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "停止朗读" }));
    fireEvent.click(screen.getByRole("button", { name: "重播朗读" }));
    await waitFor(() => expect(f.requests).toHaveLength(3));
    await act(async () => rejectStop(new Error("late stop failed")));
    expect(screen.queryByText("朗读失败，可以重播或继续阅读文字。")).toBeNull();
    expect(view.getSnapshot().envelope!.revision).toBe(revision);
  });
  it("completes the tutorial with narration disabled without any audio request", async () => {
    localStorage.setItem(NARRATION_PREFERENCE_KEY, "false");
    const { view } = await setup();
    const f = fake();
    render(ui(view, f.service));
    const revision = view.getSnapshot().envelope!.revision;
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "敬礼" } });
    fireEvent.click(screen.getByRole("button", { name: "确认动作" }));
    fireEvent.click(await screen.findByRole("button", { name: "完成剧情" }));
    await waitFor(() =>
      expect(view.getSnapshot().state!.completedStoryIds).toContain("tutorial_voice_order"),
    );
    expect(view.getSnapshot().envelope!.revision).toBe(revision + 2);
    expect(f.service.speak).not.toHaveBeenCalled();
  });
  it("starts once under StrictMode, stays playing until ended, and stops on local step advance", async () => {
    const { view } = await setup();
    const f = fake();
    const mounted = render(ui(view, f.service));
    await waitFor(() => expect(f.requests).toHaveLength(1));
    const revision = view.getSnapshot().envelope!.revision;
    mounted.rerender(ui(view, f.service));
    expect(screen.getByText("正在朗读…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(f.requests).toHaveLength(2));
    expect(f.requests[0].request.signal.aborted).toBe(true);
    expect(f.service.stop).toHaveBeenCalledWith(f.requests[0].request.requestId);
    await act(async () => f.requests[0].resolve({ type: "ended" }));
    expect(screen.getByText("正在朗读…")).toBeTruthy();
    expect(view.getSnapshot().envelope!.revision).toBe(revision);
    await act(async () => f.requests[1].resolve({ type: "ended" }));
    expect(screen.getByRole("button", { name: "重播朗读" })).toBeTruthy();
  });

  it("does not replay on wrong-action save, stops on correct action and never submits playback facts", async () => {
    const { view } = await setup();
    const f = fake();
    render(ui(view, f.service));
    await waitFor(() => expect(f.requests).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(f.requests).toHaveLength(2));
    const revision = view.getSnapshot().envelope!.revision;
    await act(async () => {
      await view.dispatch({
        type: "submitStoryInput",
        storyId: "tutorial_voice_order",
        stepId: "order",
        actionId: "wave",
      });
    });
    expect(f.requests).toHaveLength(2);
    expect(f.requests[1].request.signal.aborted).toBe(false);
    expect(view.getSnapshot().envelope!.revision).toBe(revision + 1);
    await act(async () => {
      await view.dispatch({
        type: "submitStoryInput",
        storyId: "tutorial_voice_order",
        stepId: "order",
        actionId: "salute",
      });
    });
    expect(f.requests[1].request.signal.aborted).toBe(true);
    expect(screen.getByText("输入已完成。你可以继续。")).toBeTruthy();
    expect(f.requests).toHaveLength(2);
  });

  it("cancels on mute and unmount, persists the preference, and isolates another session", async () => {
    const first = await setup();
    const second = await setup();
    const f = fake();
    const mounted = render(ui(first.view, f.service));
    await waitFor(() => expect(f.requests).toHaveLength(1));
    fireEvent.click(screen.getByText("toggle narration"));
    expect(f.requests[0].request.signal.aborted).toBe(true);
    expect(localStorage.getItem(NARRATION_PREFERENCE_KEY)).toBe("false");
    fireEvent.click(screen.getByText("toggle narration"));
    await act(async () => {});
    expect(f.requests).toHaveLength(1);
    mounted.rerender(ui(second.view, f.service));
    await waitFor(() => expect(f.requests).toHaveLength(2));
    mounted.unmount();
    expect(f.requests[1].request.signal.aborted).toBe(true);
    await act(async () => f.requests[0].resolve({ type: "ended" }));
  });

  it("cancels at locale selection, blocks stale projection, and replays actual Chinese fallback manually", async () => {
    const { view, content } = await setup();
    const f = fake();
    render(ui(view, f.service));
    await waitFor(() => expect(f.requests).toHaveLength(1));
    const load = content.loadLocalization.bind(content);
    let rejectEnglish!: (error: Error) => void;
    vi.spyOn(content, "loadLocalization").mockImplementation((ref, locale) =>
      locale === "en-US"
        ? new Promise((_, reject) => {
            rejectEnglish = reject;
          })
        : load(ref, locale),
    );
    fireEvent.click(screen.getByRole("button", { name: "切换为英语" }));
    expect(f.requests[0].request.signal.aborted).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Replay narration" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => rejectEnglish(new Error("missing English")));
    await waitFor(() => expect(view.getSnapshot().localizationStatus).toBe("fallback"));
    expect(f.requests).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Replay narration" }));
    await waitFor(() => expect(f.requests).toHaveLength(2));
    expect(f.requests[1].request.locale).toBe("zh-CN");
    expect(f.requests[1].request.text).toBe("接下来请按照提示完成一个简单输入。");
  });

  it.each(["rejection", "autoplay"])(
    "preserves text and save facts when playback fails: %s",
    async (failure) => {
      const { view } = await setup();
      const f = fake();
      render(ui(view, f.service));
      await waitFor(() => expect(f.requests).toHaveLength(1));
      const revision = view.getSnapshot().envelope!.revision;
      await act(async () => {
        if (failure === "rejection") f.requests[0].reject(new Error("unexpected"));
        else f.requests[0].resolve({ type: "failed", code: "AUTOPLAY_BLOCKED" });
      });
      expect(screen.getByText("接下来请按照提示完成一个简单输入。")).toBeTruthy();
      expect(
        screen.getByText(
          failure === "rejection"
            ? "朗读失败，可以重播或继续阅读文字。"
            : "自动播放被阻止，请点击重播。",
        ),
      ).toBeTruthy();
      expect(view.getSnapshot().envelope!.revision).toBe(revision);
      fireEvent.click(screen.getByRole("button", { name: "重播朗读" }));
      await waitFor(() => expect(f.requests).toHaveLength(2));
    },
  );

  it("accepts locale and new projection arriving together without auto replay", async () => {
    const f = fake();
    function Synced() {
      const { locale, setLocale } = useI18n();
      const copy = locale === "zh-CN" ? chinese : english;
      return (
        <>
          <button onClick={() => setLocale("en-US")}>switch</button>
          <NarrationControls storyId="s" stepId="a" narration={copy} ready />
        </>
      );
    }
    const chinese = { voiceId: "system", locale: "zh-CN", text: "你好" } as const;
    const english = { voiceId: "system", locale: "en-US", text: "Hello" } as const;
    render(
      <I18nProvider initialLocale="zh-CN" storage={null}>
        <NarrationProvider service={f.service}>
          <Synced />
        </NarrationProvider>
      </I18nProvider>,
    );
    await waitFor(() => expect(f.requests).toHaveLength(1));
    fireEvent.click(screen.getByText("switch"));
    expect(f.requests[0].request.signal.aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Replay narration" }));
    await waitFor(() => expect(f.requests).toHaveLength(2));
    expect(f.requests[1].request.text).toBe("Hello");
  });
});
