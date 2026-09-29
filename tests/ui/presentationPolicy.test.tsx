// @vitest-environment jsdom
import { useState } from "react";
import { LocaleSwitch } from "../../src/ui/LocaleSwitch";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGameContentView } from "../../src/application/gameContentView";
import { MINIMAL_GAME_CONTENT, MINIMAL_ZH_CN } from "../../src/content/fixtures/minimalCatalog";
import { DecisionPanel } from "../../src/ui/case/DecisionPanel";
import { PendingCaseReview } from "../../src/ui/case/PendingCaseReview";
import {
  createDecisionPresentationHistory,
  decisionPresentationIdentity,
} from "../../src/ui/case/presentationPolicy";
import { TestI18nProvider } from "./TestI18nProvider";

const content = createGameContentView(MINIMAL_GAME_CONTENT, MINIMAL_ZH_CN);
const node = content.cases.case_001.nodes.assessment;
type Callback = (entries: IntersectionObserverEntry[]) => void;
let callbacks: Callback[];
const entry = (visible: boolean) =>
  ({ isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }) as IntersectionObserverEntry;
const presence = (visible: boolean) => act(() => callbacks.at(-1)!([entry(visible)]));
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const options = () => screen.queryAllByRole("button");
const identity = decisionPresentationIdentity("package", "1", "case_001", "assessment");
const base = {
  caseId: "case_001",
  nodeId: "assessment",
  node,
  dispatch: vi.fn(),
  presentationIdentity: identity,
};

beforeEach(() => {
  vi.useFakeTimers();
  callbacks = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: Callback) {
        callbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("session presentation policy", () => {
  it("marks only displayed DOM, reuses a shown node, and isolates new content/session identities", () => {
    const history = createDecisionPresentationHistory();
    let view = render(<DecisionPanel {...base} presentationHistory={history} />, {
      wrapper: TestI18nProvider,
    });
    advance(1000);
    expect(options()).toHaveLength(0);
    expect(history.has(identity)).toBe(false);
    presence(true);
    advance(749);
    expect(history.has(identity)).toBe(false);
    advance(1);
    expect(options()).toHaveLength(2);
    expect(history.has(identity)).toBe(true);
    view.unmount();
    view = render(<DecisionPanel {...base} presentationHistory={history} />, {
      wrapper: TestI18nProvider,
    });
    expect(options()).toHaveLength(0);
    presence(true);
    advance(0);
    expect(options()).toHaveLength(2);
    const version2 = decisionPresentationIdentity("package", "2", "case_001", "assessment");
    view.rerender(
      <DecisionPanel {...base} presentationIdentity={version2} presentationHistory={history} />,
    );
    presence(true);
    advance(749);
    expect(options()).toHaveLength(0);
    advance(1);
    expect(history.has(version2)).toBe(true);
    const fresh = createDecisionPresentationHistory();
    view.rerender(
      <DecisionPanel {...base} presentationIdentity={version2} presentationHistory={fresh} />,
    );
    expect(options()).toHaveLength(0);
    presence(true);
    advance(749);
    expect(fresh.has(version2)).toBe(false);
    advance(1);
    expect(fresh.has(version2)).toBe(true);
  });

  it("does not mark offscreen expiration and resumes elapsed preparation only while still mounted", () => {
    const history = createDecisionPresentationHistory();
    const view = render(<DecisionPanel {...base} presentationHistory={history} />, {
      wrapper: TestI18nProvider,
    });
    presence(true);
    advance(300);
    presence(false);
    advance(800);
    expect(history.has(identity)).toBe(false);
    expect(options()).toHaveLength(0);
    presence(true);
    advance(0);
    expect(options()).toHaveLength(2);
    view.unmount();
    const unshown = createDecisionPresentationHistory();
    const first = render(<DecisionPanel {...base} presentationHistory={unshown} />, {
      wrapper: TestI18nProvider,
    });
    presence(true);
    advance(300);
    const old = callbacks.at(-1)!;
    first.unmount();
    render(<DecisionPanel {...base} presentationHistory={unshown} />, {
      wrapper: TestI18nProvider,
    });
    act(() => old([entry(true)]));
    advance(1000);
    expect(options()).toHaveLength(0);
    expect(unshown.has(identity)).toBe(false);
    presence(true);
    advance(749);
    expect(options()).toHaveLength(0);
    advance(1);
    expect(options()).toHaveLength(2);
  });

  it("uses the latest batched observer state instead of a previous visible entry", () => {
    const history = createDecisionPresentationHistory();
    render(<DecisionPanel {...base} presentationHistory={history} />, {
      wrapper: TestI18nProvider,
    });
    act(() => callbacks.at(-1)!([entry(true), entry(false)]));
    advance(1000);
    expect(options()).toHaveLength(0);
    expect(history.has(identity)).toBe(false);
  });

  it.each([200, 1200])("overlaps the 750ms budget with %ims of committed work", (workMs) => {
    const started = Date.now();
    const view = render(<DecisionPanel {...base} disabled thinkingStartedAt={started} />, {
      wrapper: TestI18nProvider,
    });
    presence(true);
    advance(workMs);
    expect(options()).toHaveLength(0);
    view.rerender(<DecisionPanel {...base} thinkingStartedAt={started} />);
    const remaining = Math.max(0, 750 - workMs);
    if (remaining) {
      advance(remaining - 1);
      expect(options()).toHaveLength(0);
      advance(1);
    } else advance(0);
    expect(options()).toHaveLength(2);
  });

  it("immediate still waits for visibility and real work; reduced motion does not change normal time", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    const view = render(<DecisionPanel {...base} presentationMode="immediate" disabled />, {
      wrapper: TestI18nProvider,
    });
    advance(2000);
    expect(options()).toHaveLength(0);
    presence(true);
    advance(2000);
    expect(options()).toHaveLength(0);
    view.rerender(<DecisionPanel {...base} presentationMode="immediate" />);
    advance(0);
    expect(options()).toHaveLength(2);
    view.unmount();
    render(<DecisionPanel {...base} />, { wrapper: TestI18nProvider });
    presence(true);
    advance(749);
    expect(options()).toHaveLength(0);
    advance(1);
    expect(options()).toHaveLength(2);
  });

  it("pending start rejects without observer retries and explicit retry starts a fresh clock", async () => {
    const times = vi.fn();
    const dispatch = vi.fn().mockRejectedValue(new Error("save failed"));
    render(
      <PendingCaseReview
        caseId="case_001"
        dispatch={dispatch}
        disabled={false}
        onThinkingStarted={times}
      />,
      { wrapper: TestI18nProvider },
    );
    advance(1000);
    expect(dispatch).not.toHaveBeenCalled();
    await act(async () => callbacks.at(-1)!([entry(true)]));
    expect(screen.getByRole("alert")).toBeTruthy();
    await act(async () => callbacks.at(-1)!([entry(true)]));
    expect(dispatch).toHaveBeenCalledTimes(1);
    advance(1000);
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(times.mock.calls[1][0]).toBeGreaterThan(times.mock.calls[0][0]);
  });
});

it("locale changes reuse the same shown marker and identity tuples cannot collide", () => {
  const history = createDecisionPresentationHistory();
  render(
    <>
      <LocaleSwitch />
      <DecisionPanel {...base} presentationHistory={history} />
    </>,
    { wrapper: TestI18nProvider },
  );
  presence(true);
  advance(750);
  fireEvent.click(screen.getByRole("button", { name: "切换为英语" }));
  expect(history.has(identity)).toBe(true);
  expect(screen.getByRole("group", { name: "Decision options" })).toBeTruthy();
  expect(decisionPresentationIdentity("a:b", "c", "d", "e")).not.toBe(
    decisionPresentationIdentity("a", "b:c", "d", "e"),
  );
  expect(history.has(decisionPresentationIdentity("other", "1", "case_001", "assessment"))).toBe(
    false,
  );
  expect(history.has(decisionPresentationIdentity("package", "1", "case_001", "disposition"))).toBe(
    false,
  );
});

it("fallback geometry waits for scroll-container visibility even in immediate mode", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  let onscreen = false;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const clip = (this as HTMLElement).dataset.clip === "true";
    const top = clip ? 0 : onscreen ? 10 : 210;
    const bottom = clip ? 100 : top + 80;
    return {
      top,
      bottom,
      left: 0,
      right: 300,
      width: 300,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => ({}),
    };
  });
  const history = createDecisionPresentationHistory();
  render(
    <div data-clip="true" style={{ overflowY: "auto" }}>
      <DecisionPanel {...base} presentationHistory={history} presentationMode="immediate" />
    </div>,
    { wrapper: TestI18nProvider },
  );
  advance(1000);
  expect(options()).toHaveLength(0);
  expect(history.has(identity)).toBe(false);
  onscreen = true;
  fireEvent.scroll(window);
  advance(0);
  expect(options()).toHaveLength(2);
  expect(history.has(identity)).toBe(true);
});

it.each([200, 1200])(
  "pending start/save lasting %ims hands its original clock to the committed node",
  async (workMs) => {
    let finish!: () => void;
    const saved = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const history = createDecisionPresentationHistory();
    function Handoff() {
      const [committed, setCommitted] = useState(false);
      const [startedAt, setStartedAt] = useState<number>();
      const dispatch = vi.fn().mockImplementation(async () => {
        await saved;
        setCommitted(true);
        return { ok: true };
      });
      return committed ? (
        <DecisionPanel {...base} thinkingStartedAt={startedAt} presentationHistory={history} />
      ) : (
        <PendingCaseReview
          caseId="case_001"
          disabled={false}
          dispatch={dispatch}
          onThinkingStarted={setStartedAt}
        />
      );
    }
    render(<Handoff />, { wrapper: TestI18nProvider });
    presence(true);
    advance(workMs);
    expect(options()).toHaveLength(0);
    expect(history.has(identity)).toBe(false);
    await act(async () => finish());
    presence(true);
    const remaining = Math.max(0, 750 - workMs);
    if (remaining) {
      advance(remaining - 1);
      expect(options()).toHaveLength(0);
      advance(1);
    } else advance(0);
    expect(options()).toHaveLength(2);
    expect(history.has(identity)).toBe(true);
  },
);
