// @vitest-environment jsdom

import { configureDiagnostics, type DiagnosticEvent } from "../../src/shared/diagnostics";
import { useEffect, useSyncExternalStore } from "react";
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
import { SaveRepositoryError } from "../../src/storage/saveRepository";
import { I18nProvider, useI18n } from "../../src/ui/i18n";
import { StoryOverlay } from "../../src/ui/presentation/story/StoryOverlay";
import { VoiceInputProvider } from "../../src/ui/input/VoiceInputProvider";
import {
  VoiceInputError,
  type VoiceInputRequest,
  type VoiceInputService,
} from "../../src/shared/voiceInput";
import type { RecognizedAction } from "../../src/shared/recognizedAction";

const storyId = "inspection_after_case_001";
const now = "2026-09-16T00:00:00.000Z";

function voiceFixture() {
  const attempts: {
    request: VoiceInputRequest;
    resolve(result: RecognizedAction): void;
    reject(error: unknown): void;
  }[] = [];
  const service: VoiceInputService = {
    available: true,
    recognize: vi.fn(
      (request) =>
        new Promise<RecognizedAction>((resolve, reject) => {
          attempts.push({ request, resolve, reject });
          request.onPhase("recording");
        }),
    ),
  };
  return { service, attempts };
}

async function beginVoice() {
  fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
  fireEvent.click(screen.getByRole("button", { name: "开始录音" }));
}

describe("voice action rounds with a real session", () => {
  it("keeps a text fallback when no voice service is installed", async () => {
    const { view } = await setup();
    render(ui(view));
    await firstInput();
    fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
    expect(screen.getByText(/当前环境无法使用语音/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "开始录音" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "文字输入" }));
    submit("敬礼");
    await screen.findByText("巡视员检查了案件记录，准备离开。");
  });

  it("cancels a capturing round when another command makes the session busy", async () => {
    const { view, saves } = await setup();
    const { service, attempts } = voiceFixture();
    render(ui(view, service));
    await firstInput();
    await beginVoice();
    const gate = deferred();
    const commit = saves.commit.bind(saves);
    const commitSpy = vi.spyOn(saves, "commit").mockImplementation(async (input) => {
      await gate.promise;
      return commit(input);
    });
    let pending!: ReturnType<GameSessionView["dispatch"]>;
    act(() => {
      pending = view.dispatch({
        type: "submitStoryInput",
        storyId,
        stepId: "salute_at_arrival",
        actionId: "wave",
      });
    });
    expect(attempts[0].request.signal.aborted).toBe(true);
    await act(async () => attempts[0].resolve({ type: "known", actionId: "wave" }));
    expect(commitSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate.resolve();
      await pending;
    });
    expect(commitSpy).toHaveBeenCalledTimes(1);
  });

  it("finishes recording explicitly, keeps unknown local, and commits one wrong result", async () => {
    const { view } = await setup();
    const { service, attempts } = voiceFixture();
    render(ui(view, service));
    await firstInput();
    const dispatch = vi.spyOn(view, "dispatch");
    const revision = view.getSnapshot().envelope!.revision;
    await beginVoice();
    fireEvent.click(screen.getByRole("button", { name: "结束录音并识别" }));
    expect(attempts[0].request.stopSignal.aborted).toBe(true);
    expect(attempts[0].request.signal.aborted).toBe(false);
    await act(async () => attempts[0].resolve({ type: "unknown" }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(view.getSnapshot().envelope!.revision).toBe(revision);
    expect(screen.getByText(/未能确定一个动作/)).toBeTruthy();
    const start = screen.getByRole("button", { name: "开始录音" });
    act(() => {
      fireEvent.click(start);
      fireEvent.click(start);
    });
    expect(attempts).toHaveLength(2);
    await act(async () => attempts[1].resolve({ type: "known", actionId: "wave" }));
    await screen.findByText("权威 -2");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(view.getSnapshot().envelope!.revision).toBe(revision + 1);
  });

  it.each(["cancel", "text", "locale", "unmount"] as const)(
    "discards a late known result after %s",
    async (cause) => {
      const { view } = await setup();
      const { service, attempts } = voiceFixture();
      const mounted = render(ui(view, service));
      await firstInput();
      const dispatch = vi.spyOn(view, "dispatch");
      await beginVoice();
      if (cause === "cancel") fireEvent.click(screen.getByRole("button", { name: "取消本轮" }));
      if (cause === "text") fireEvent.click(screen.getByRole("button", { name: "文字输入" }));
      if (cause === "locale") fireEvent.click(screen.getByRole("button", { name: "切换为英语" }));
      if (cause === "unmount") mounted.unmount();
      expect(attempts[0].request.signal.aborted).toBe(true);
      await act(async () => attempts[0].resolve({ type: "known", actionId: "wave" }));
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it("cannot send an old voice result into another session at the same step", async () => {
    const previous = await setup();
    const next = await setup();
    const { service, attempts } = voiceFixture();
    const mounted = render(ui(previous.view, service));
    await firstInput();
    const oldDispatch = vi.spyOn(previous.view, "dispatch");
    const newDispatch = vi.spyOn(next.view, "dispatch");
    await beginVoice();
    mounted.rerender(ui(next.view, service));
    await firstInput();
    expect(attempts[0].request.signal.aborted).toBe(true);
    await act(async () => attempts[0].resolve({ type: "known", actionId: "wave" }));
    expect(oldDispatch).not.toHaveBeenCalled();
    expect(newDispatch).not.toHaveBeenCalled();
  });

  it("discards an old service result when the provider changes", async () => {
    const { view } = await setup();
    const previous = voiceFixture();
    const next = voiceFixture();
    const mounted = render(ui(view, previous.service));
    await firstInput();
    const dispatch = vi.spyOn(view, "dispatch");
    await beginVoice();
    mounted.rerender(ui(view, next.service));
    expect(previous.attempts[0].request.signal.aborted).toBe(true);
    await act(async () => previous.attempts[0].resolve({ type: "known", actionId: "wave" }));
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "开始录音" }));
    expect(next.attempts).toHaveLength(1);
  });

  it("shows technical errors without penalties and permits a new recording", async () => {
    const { view } = await setup();
    const { service, attempts } = voiceFixture();
    render(ui(view, service));
    await firstInput();
    const revision = view.getSnapshot().envelope!.revision;
    await beginVoice();
    await act(async () => attempts[0].reject(new VoiceInputError("PERMISSION_DENIED")));
    expect(screen.getByRole("alert").textContent).toContain("麦克风权限被拒绝");
    expect(view.getSnapshot().envelope!.revision).toBe(revision);
    fireEvent.click(screen.getByRole("button", { name: "开始录音" }));
    await act(async () => attempts[1].resolve({ type: "known", actionId: "salute" }));
    await screen.findByText("巡视员检查了案件记录，准备离开。");
  });

  it("preserves a voice command already saving when the language changes", async () => {
    const { view, saves } = await setup();
    const { service, attempts } = voiceFixture();
    render(ui(view, service));
    await firstInput();
    const gate = deferred();
    const commit = saves.commit.bind(saves);
    vi.spyOn(saves, "commit").mockImplementation(async (input) => {
      await gate.promise;
      return commit(input);
    });
    await beginVoice();
    await act(async () => attempts[0].resolve({ type: "known", actionId: "wave" }));
    fireEvent.click(screen.getByRole("button", { name: "切换为英语" }));
    await act(async () => gate.resolve());
    await screen.findByText("Authority -2");
    expect(screen.getByText(/That action does not meet/)).toBeTruthy();
  });
});
afterEach(() => {
  configureDiagnostics(() => undefined);
  cleanup();
  vi.restoreAllMocks();
});

async function setup() {
  const saves = new InMemorySaveRepository([
    createDemoSave("profile", "save", ACTION_INPUT_GAME_CONTENT, now),
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
  await session.load("save", "profile");
  for (const command of [
    {
      type: "submitStoryInput",
      storyId: "tutorial_voice_order",
      stepId: "order",
      actionId: "salute",
    },
    { type: "completeStory", storyId: "tutorial_voice_order" },
    { type: "startCase", caseId: "case_001" },
    {
      type: "chooseOption",
      caseId: "case_001",
      nodeId: "assessment",
      choiceId: "insufficient_evidence",
    },
    { type: "completeStory", storyId: "story_after_case_001" },
  ] as const)
    expect((await session.dispatch(command)).ok).toBe(true);
  await view.setLocale("zh-CN");
  return { saves, session, view, content };
}

function Presentation({ view }: { view: GameSessionView }) {
  const snapshot = useSyncExternalStore(view.subscribe, view.getSnapshot);
  const { locale } = useI18n();
  useEffect(() => {
    void view.setLocale(locale);
  }, [locale, view]);
  // This is the same recovery precedence used by App, with the real reload operation.
  if (snapshot.status === "needsReload" || snapshot.status === "error")
    return <button onClick={() => void view.reload()}>Reload</button>;
  return (
    <StoryOverlay
      sessionView={view}
      snapshot={snapshot}
      endingOpen={false}
      onCloseEnding={() => {}}
    />
  );
}

function ui(view: GameSessionView, service?: VoiceInputService) {
  return (
    <I18nProvider initialLocale="zh-CN" storage={null}>
      <VoiceInputProvider service={service}>
        <Presentation view={view} />
      </VoiceInputProvider>
    </I18nProvider>
  );
}

function submit(text: string) {
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form")!);
}

async function firstInput() {
  fireEvent.click(await screen.findByRole("button", { name: "继续" }));
  return screen.findByRole("textbox");
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("text action story UI with a real session", () => {
  it("keeps unknown local, saves wrong penalties, and restores B/C/D/E from committed positions", async () => {
    const { saves, view } = await setup();
    const diagnosticEvents: DiagnosticEvent[] = [];
    configureDiagnostics((event) => diagnosticEvents.push(event));
    let mounted = render(ui(view));
    await firstInput();
    const dispatch = vi.spyOn(view, "dispatch");
    const before = view.getSnapshot().envelope!;
    expect(screen.queryByRole("button", { name: "继续" })).toBeNull();
    expect(screen.queryByRole("button", { name: /跳过/ })).toBeNull();
    submit("敬礼还是挥手");
    expect(screen.getByText(/未能确定一个动作/)).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();
    expect(
      diagnosticEvents.some(
        (event) => event.event === "input.recognized" && event.data?.recognition === "unknown",
      ),
    ).toBe(true);
    expect(diagnosticEvents.some((event) => event.event === "command.started")).toBe(false);
    expect(JSON.stringify(diagnosticEvents)).not.toContain("敬礼还是挥手");
    expect((await saves.load("save", "profile"))!.revision).toBe(before.revision);

    submit("挥手");
    await screen.findByText(/动作不符合要求/);
    expect(screen.getByText("权威 -2")).toBeTruthy();
    const recognized = diagnosticEvents.filter(
      (event) => event.event === "input.recognized" && event.data?.recognition === "known",
    )[0];
    expect(diagnosticEvents.find((event) => event.event === "session.published")?.operationId).toBe(
      recognized.operationId,
    );
    expect(view.getSnapshot().envelope!.revision).toBe(before.revision + 1);
    expect(document.activeElement).toBe(screen.getByRole("textbox"));

    fireEvent.click(screen.getByRole("button", { name: "切换为英语" }));
    await screen.findByText("Authority -2");
    expect(screen.getByText(/That action does not meet/)).toBeTruthy();
    submit("salute");
    await screen.findByText("The inspector checks the case record and prepares to leave.");
    expect(view.getSnapshot().state!.storyCheckpoint).toEqual({
      storyId,
      resumeStepId: "inspection_notice",
    });
    mounted.unmount();
    await view.reload();
    mounted = render(ui(view));
    await screen.findByText("巡视员检查了案件记录，准备离开。");
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    submit("挥手");
    await screen.findByText("权威 -1");
    mounted.unmount();
    await view.reload();
    mounted = render(ui(view));
    await screen.findByText("请再次输入“敬礼”，向巡视员致意。");
    submit("敬礼");
    await screen.findByText("巡视结束，你可以继续处理接下来的事务。");
    expect(view.getSnapshot().state!.storyCheckpoint?.resumeStepId).toBe("departure");
    const tailRevision = view.getSnapshot().envelope!.revision;
    fireEvent.click(screen.getByRole("button", { name: "切换为英语" }));
    await screen.findByRole("button", { name: "Complete story" });
    expect(view.getSnapshot().envelope!.revision).toBe(tailRevision);
    fireEvent.click(screen.getByRole("button", { name: "Complete story" }));
    await waitFor(() => expect(view.getSnapshot().state!.pendingStoryIds).toEqual([]));
    expect(view.getSnapshot().state!.storyCheckpoint).toBeNull();
  });

  it("does not rewind a local cursor on locale or attribute presentation updates", async () => {
    const { view } = await setup();
    render(ui(view));
    await firstInput();
    fireEvent.click(screen.getByRole("button", { name: "切换为英语" }));
    await screen.findByText(/Type “salute” to greet/);
    expect(screen.queryByText("The inspector arrives at court. Prepare to greet them.")).toBeNull();
    submit("salute");
    await screen.findByText("The inspector checks the case record and prepares to leave.");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch to Simplified Chinese" }));
    await screen.findByText("请再次输入“敬礼”，向巡视员致意。");
    expect(screen.queryByText("巡视员检查了案件记录，准备离开。")).toBeNull();
  });

  it("recognizes the selected language even when displayed content falls back to Chinese", async () => {
    const { view, content } = await setup();
    const loadLocalization = content.loadLocalization.bind(content);
    vi.spyOn(content, "loadLocalization").mockImplementation((ref, locale) => {
      if (locale === "en-US") return Promise.reject(new Error("language unavailable"));
      return loadLocalization(ref, locale);
    });
    render(ui(view));
    await firstInput();
    fireEvent.click(screen.getByRole("button", { name: "切换为英语" }));
    await waitFor(() => expect(view.getSnapshot().localizationStatus).toBe("fallback"));
    expect(screen.getByText(/请输入“敬礼”迎接巡视员/)).toBeTruthy();
    const dispatch = vi.spyOn(view, "dispatch");
    submit("敬礼");
    expect(screen.getByText(/No single action was recognized/)).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();
    submit("salute");
    await screen.findByText("巡视员检查了案件记录，准备离开。");
    expect(dispatch).toHaveBeenCalledWith(
      {
        type: "submitStoryInput",
        storyId,
        stepId: "salute_at_arrival",
        actionId: "salute",
      },
      expect.objectContaining({ operationId: expect.any(String) }),
    );
  });

  it("locks the round synchronously and preserves a submitted action across language changes", async () => {
    const { saves, view } = await setup();
    render(ui(view));
    await firstInput();
    const gate = deferred();
    const commit = saves.commit.bind(saves);
    const spy = vi.spyOn(saves, "commit").mockImplementation(async (input) => {
      await gate.promise;
      return commit(input);
    });
    const revision = view.getSnapshot().envelope!.revision;
    const form = screen.getByRole("textbox").closest("form")!;
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "挥手" } });
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/动作不符合要求/)).toBeNull();
    expect(view.getSnapshot().envelope!.revision).toBe(revision);
    fireEvent.click(screen.getByRole("button", { name: "切换为英语" }));
    fireEvent.submit(form);
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve());
    await screen.findByText(/That action does not meet/);
    expect(view.getSnapshot().envelope!.revision).toBe(revision + 1);
    expect(view.getSnapshot().state!.storyCheckpoint?.resumeStepId).toBe("salute_at_arrival");
    submit("salute");
    await screen.findByText("The inspector checks the case record and prepares to leave.");
  });

  it("does not submit an IME confirmation and requires a later explicit submit", async () => {
    const { view } = await setup();
    render(ui(view));
    const input = await firstInput();
    const dispatch = vi.spyOn(view, "dispatch");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "敬礼" } });
    expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 })).toBe(false);
    fireEvent.submit(input.closest("form")!);
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.submit(input.closest("form")!);
    await screen.findByText("巡视员检查了案件记录，准备离开。");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed save on the same step and permits a fresh retry", async () => {
    const { saves, view } = await setup();
    render(ui(view));
    await firstInput();
    const before = view.getSnapshot().envelope;
    vi.spyOn(saves, "commit").mockRejectedValueOnce(
      new SaveRepositoryError("INVALID_INPUT", "rejected"),
    );
    submit("敬礼");
    await screen.findByText("存档输入无效。");
    expect(view.getSnapshot().envelope).toBe(before);
    expect(screen.getByRole("textbox")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "切换为英语" }));
    await screen.findByText("The save input is invalid.");
    submit("salute");
    await screen.findByText("The inspector checks the case record and prepares to leave.");
  });

  it("requires explicit reload after an uncertain commit and resumes the persisted checkpoint", async () => {
    const { saves, view } = await setup();
    render(ui(view));
    await firstInput();
    const commit = saves.commit.bind(saves);
    vi.spyOn(saves, "commit").mockImplementationOnce(async (input) => {
      await commit(input);
      throw new Error("response lost");
    });
    submit("敬礼");
    const reload = await screen.findByRole("button", { name: "Reload" });
    expect(view.getSnapshot().status).toBe("needsReload");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(reload);
    await screen.findByText("巡视员检查了案件记录，准备离开。");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("discards an old session's delayed feedback after switching profiles", async () => {
    const old = await setup();
    const next = await setup();
    const mounted = render(ui(old.view));
    await firstInput();
    const gate = deferred();
    const commit = old.saves.commit.bind(old.saves);
    vi.spyOn(old.saves, "commit").mockImplementation(async (input) => {
      await gate.promise;
      return commit(input);
    });
    submit("挥手");
    mounted.rerender(ui(next.view));
    await firstInput();
    await act(async () => gate.resolve());
    expect(screen.queryByText(/动作不符合要求/)).toBeNull();
    submit("敬礼");
    await screen.findByText("巡视员检查了案件记录，准备离开。");
  });
});
