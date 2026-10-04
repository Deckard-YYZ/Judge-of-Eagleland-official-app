// @vitest-environment jsdom
import { StrictMode, useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGameSessionView, type GameSessionView } from "../../src/application/gameSessionView";
import type { ProfileEntry, ProfileEntrySnapshot } from "../../src/application/profileEntry";
import {
  CONFIGURATION_PILOT_GAME_CONTENT,
  CONFIGURATION_PILOT_LOCALIZATIONS,
} from "../../src/app/configurationPilot";
import { DecisionPanel } from "../../src/ui/case/DecisionPanel";
import { App } from "../../src/ui/App";
import { SaveRepositoryError } from "../../src/storage/saveRepository";
import { InMemorySaveRepository } from "../../src/storage/inMemorySaveRepository";
import { TestI18nProvider } from "./TestI18nProvider";
import { pilotSave, pilotSession } from "../fixtures/configurationPilot";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 10,
    bottom: 110,
    left: 10,
    right: 510,
    width: 500,
    height: 100,
    x: 10,
    y: 10,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function setup(
  game = CONFIGURATION_PILOT_GAME_CONTENT,
  localizations = CONFIGURATION_PILOT_LOCALIZATIONS,
) {
  const saves = new InMemorySaveRepository([pilotSave(game)]);
  const { session, content } = await pilotSession(saves, game, localizations);
  const view = createGameSessionView(session, content);
  await session.dispatch({ type: "startCase", caseId: "intake" });
  await view.setLocale("zh-CN");
  return { session, view, saves };
}
function Decision({ view }: { view: GameSessionView }) {
  const snapshot = useSyncExternalStore(view.subscribe, view.getSnapshot);
  const progress = snapshot.state!.cases.intake;
  if (progress.status !== "active") return <span>Settled</span>;
  // This is the same round-key contract used by CaseReader, independent of localized node objects.
  return (
    <DecisionPanel
      key={progress.currentNodeId}
      caseId="intake"
      nodeId={progress.currentNodeId}
      node={snapshot.content!.cases.intake.nodes[progress.currentNodeId]}
      dispatch={view.dispatch}
      disabled={snapshot.status !== "ready"}
    />
  );
}
const renderDecision = (view: GameSessionView) =>
  render(
    <StrictMode>
      <TestI18nProvider>
        <Decision view={view} />
      </TestI18nProvider>
    </StrictMode>,
  );

describe("configured instruction with real Session dispatch", () => {
  it("starts its independent delay when options are ready and keeps that clock across localization", async () => {
    const { view } = await setup();
    renderDecision(view);
    await tick(749);
    expect(screen.queryByRole("button", { name: /按指示确认登记/ })).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
    await tick(1);
    expect(screen.getByRole("button", { name: /按指示确认登记/ })).toBeTruthy();
    await tick(600);
    await act(async () => {
      await view.setLocale("en-US");
    });
    await tick(899);
    expect(screen.queryByRole("note")).toBeNull();
    await tick(1);
    expect(screen.getByRole("note").textContent).toContain("Instruction: confirm the intake.");
    expect(screen.getByRole("button", { name: /Review the intake independently/ })).toBeTruthy();
  });
  it("allows disobedience, removes the completed round, and cancels a fast selection's late timer", async () => {
    const { session, view } = await setup();
    renderDecision(view);
    await tick(750);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /自行重新核对登记/ })),
    );
    expect(session.getSnapshot().state?.cases.intake).toMatchObject({
      status: "active",
      currentNodeId: "disposition",
      history: [{ choiceId: "review" }],
    });
    await tick(3000);
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByRole("button", { name: /确认登记有效/ })).toBeTruthy();
  });
  it("retains the current instruction and round after a failed save, then clears them after a successful retry", async () => {
    const { session, view, saves } = await setup();
    renderDecision(view);
    await tick(750);
    await tick(1500);
    const note = screen.getByRole("note").textContent;
    vi.spyOn(saves, "commit").mockRejectedValueOnce(
      new SaveRepositoryError("INVALID_SAVE", "injected precommit failure"),
    );
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /自行重新核对登记/ })),
    );
    expect(session.getSnapshot().state?.cases.intake).toMatchObject({
      status: "active",
      currentNodeId: "assessment",
      history: [],
    });
    expect(screen.getByRole("note").textContent).toBe(note);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /自行重新核对登记/ })),
    );
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("starts a separately configured second round only after its own options become ready", async () => {
    const game = structuredClone(CONFIGURATION_PILOT_GAME_CONTENT);
    game.configuration!.instructions.second_round = {
      caseId: "intake",
      nodeId: "disposition",
      choiceId: "approve",
      delayMs: 1000,
    };
    const locales = structuredClone(CONFIGURATION_PILOT_LOCALIZATIONS);
    for (const localized of Object.values(locales))
      localized.instructions!.second_round = {
        blocks: [{ type: "paragraph", text: "第二轮指示" }],
      };
    const { view } = await setup(game, locales);
    renderDecision(view);
    await tick(750);
    await tick(1500);
    expect(screen.getByRole("note")).toBeTruthy();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /自行重新核对登记/ })),
    );
    expect(screen.queryByRole("note")).toBeNull();
    await tick(749);
    expect(screen.queryByRole("button", { name: /确认登记有效/ })).toBeNull();
    await tick(1);
    expect(screen.getByRole("button", { name: /确认登记有效/ })).toBeTruthy();
    await tick(999);
    expect(screen.queryByRole("note")).toBeNull();
    await tick(1);
    expect(screen.getByRole("note").textContent).toBe("第二轮指示");
  });
});

it("runs the physical package through App, two real decisions, information → mandatory action, and the dispatched follow-up", async () => {
  const { session, content, saves } = await pilotSession();
  const view = createGameSessionView(session, content);
  await view.setLocale("zh-CN");
  const profile = { profileId: "pilot-profile", displayName: "Pilot" };
  const snapshot: ProfileEntrySnapshot = { status: "ready", profiles: [profile], error: null };
  const entered = async () => ({ ok: true as const, profile, session: view });
  const entry: ProfileEntry = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    enter: entered,
    register: entered,
  };
  render(
    <StrictMode>
      <App
        profileEntry={entry}
        caseOpenDelayMs={0}
        decisionRevealDelayMs={0}
        presentationMode="immediate"
      />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole("button", { name: "选择档案员 Pilot" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "登录" })));
  await tick(0);
  fireEvent.click(screen.getByRole("button", { name: "登记复核，待开始" }));
  await tick(1);
  await tick(1);
  expect(screen.getByRole("button", { name: /自行重新核对登记/ })).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /自行重新核对登记/ })));
  await tick(1);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /确认登记有效/ })));
  await tick(0);
  expect(screen.getByText("判决已归档。请确认收到通知，再执行敬礼动作。")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "跳过" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  expect(screen.getByText("请敬礼确认。错误动作会记录，仍须完成敬礼。")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "输入动作" }), {
    target: { value: "挥手" },
  });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "确认动作" })));
  await tick(0);
  expect(session.getSnapshot().state?.attributes.input_errors).toBe(1);
  expect(screen.getByRole("textbox", { name: "输入动作" })).toBeTruthy();
  expect(session.getSnapshot().state?.pendingStoryIds).toEqual(["judgment_notice"]);
  fireEvent.change(screen.getByRole("textbox", { name: "输入动作" }), {
    target: { value: "敬礼" },
  });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "确认动作" })));
  await tick(0);
  expect(screen.queryByRole("dialog", { name: "重要剧情" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "后续听证，待开始" }));
  await tick(1);
  await tick(1);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /完成后续听证/ })));
  await tick(0);
  const committed = await saves.load("pilot-save", "pilot-profile");
  expect(committed?.state.cases.followup.status).toBe("resolved");
  expect(committed?.state.configurationFacts).toHaveLength(7);
  expect(committed?.state.completedStoryIds).toEqual(["judgment_notice"]);
});
