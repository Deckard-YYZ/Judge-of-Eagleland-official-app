// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameContentView } from "../../src/application/gameContentView";
import { MINIMAL_GAME_CONTENT, MINIMAL_ZH_CN } from "../../src/content/fixtures/minimalCatalog";
import { DecisionPanel } from "../../src/ui/case/DecisionPanel";
import { TestI18nProvider } from "./TestI18nProvider";

type ObserverCallback = (entries: IntersectionObserverEntry[]) => void;
const CONTENT = createGameContentView(MINIMAL_GAME_CONTENT, MINIMAL_ZH_CN);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "IntersectionObserver");
});

describe("DecisionPanel viewport reveal", () => {
  it("shows thinking after intersection, then reveals all options together", () => {
    vi.useFakeTimers();
    let callback: ObserverCallback | null = null;
    const disconnect = vi.fn();
    const observe = vi.fn();

    class TestIntersectionObserver {
      constructor(nextCallback: ObserverCallback) {
        callback = nextCallback;
      }

      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = "0px";
      thresholds = [0.15];
    }

    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: TestIntersectionObserver,
    });

    const node = CONTENT.cases.case_001.nodes.assessment;
    const { rerender } = render(
      <DecisionPanel
        caseId="case_001"
        nodeId="assessment"
        node={node}
        dispatch={vi.fn()}
        revealDelayMs={2_500}
      />,
      { wrapper: TestI18nProvider },
    );

    expect(screen.getByText("滚动至此以准备裁定选项")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /现有材料不足/ })).toBeNull();

    act(() => {
      callback?.([{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry]);
    });
    expect(screen.getByText("推演中")).toBeTruthy();
    act(() => vi.advanceTimersByTime(2_499));
    expect(screen.queryByRole("button", { name: /现有材料不足/ })).toBeNull();
    act(() => vi.advanceTimersByTime(1));

    expect(screen.getByRole("button", { name: /现有材料不足/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /确认违规/ })).toBeTruthy();
    expect(screen.getByText("powered by GPT")).toBeTruthy();

    rerender(
      <DecisionPanel
        caseId="case_001"
        nodeId="disposition"
        node={CONTENT.cases.case_001.nodes.disposition}
        dispatch={vi.fn()}
        revealDelayMs={2_500}
      />,
    );
    expect(screen.getByText("滚动至此以准备裁定选项")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /给予书面警告/ })).toBeNull();
    expect(disconnect).toHaveBeenCalled();
  });

  it("checks viewport geometry before the timed wait when IntersectionObserver is unavailable", () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 10,
      bottom: 110,
      left: 10,
      right: 310,
      width: 300,
      height: 100,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    });
    const node = CONTENT.cases.case_001.nodes.assessment;
    render(
      <DecisionPanel
        caseId="case_001"
        nodeId="assessment"
        node={node}
        dispatch={vi.fn()}
        revealDelayMs={0}
      />,
      { wrapper: TestI18nProvider },
    );

    expect(screen.getByText("推演中")).toBeTruthy();
    act(() => vi.runOnlyPendingTimers());
    expect(screen.getAllByRole("button")).toHaveLength(node.choices.length);
  });
});
