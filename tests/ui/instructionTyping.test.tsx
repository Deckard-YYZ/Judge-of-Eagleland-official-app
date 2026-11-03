// @vitest-environment jsdom
import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useInstructionTyping } from "../../src/ui/case/useInstructionTyping";
const tick = async (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("reveals complete Unicode graphemes, pauses while obscured and replaces localized copy without mixed characters", async () => {
  vi.useFakeTimers();
  const blocks = [{ type: "quote" as const, text: "👩‍⚖️é中文" }];
  const { result, rerender } = renderHook(
    ({ visible, copy }) => useInstructionTyping(copy, true, visible),
    { initialProps: { visible: true, copy: blocks } },
  );
  await tick(80);
  expect(result.current.revealed[0]).toEqual({ type: "quote", text: "👩‍⚖️" });
  rerender({ visible: false, copy: blocks });
  await tick(5000);
  expect(result.current.revealed[0].text).toBe("👩‍⚖️");
  rerender({ visible: true, copy: [{ type: "quote", text: "ABCD" }] });
  expect(result.current.revealed[0].text).toBe("A");
  await tick(200);
  expect(result.current.complete).toBe(true);
  expect(result.current.revealed[0].text).toBe("ABCD");
});
it("reveals ordinary copy at 15 graphemes per second", async () => {
  vi.useFakeTimers();
  const blocks = [{ type: "paragraph" as const, text: "字".repeat(30) }];
  const { result } = renderHook(() => useInstructionTyping(blocks, true, true));
  await tick(1000);
  expect(result.current.revealed[0].text).toBe("字".repeat(15));
  expect(result.current.complete).toBe(false);
  await tick(1000);
  expect(result.current.revealed[0].text).toBe(blocks[0].text);
  expect(result.current.complete).toBe(true);
});
it("caps long copy at 3000ms and clears the presentation timer on unmount", async () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(() =>
    useInstructionTyping([{ type: "paragraph", text: "字".repeat(200) }], true, true),
  );
  await tick(2980);
  expect(result.current.complete).toBe(false);
  await tick(20);
  expect(result.current.complete).toBe(true);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it("shows full text immediately for reduced motion, without a typing timer", () => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const { result } = renderHook(() =>
    useInstructionTyping([{ type: "heading", text: "完整内容" }], true, true),
  );
  expect(result.current.complete).toBe(true);
  expect(result.current.revealed[0].text).toBe("完整内容");
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps completed presentation complete when switching to a longer translation", async () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ text }) => useInstructionTyping([{ type: "paragraph", text }], true, true),
    { initialProps: { text: "短文" } },
  );
  await tick(140);
  expect(result.current.complete).toBe(true);
  rerender({ text: "A much longer translated instruction" });
  expect(result.current.complete).toBe(true);
  expect(result.current.revealed[0].text).toBe("A much longer translated instruction");
});
it("settles elapsed completion when hiding before the final interval callback", async () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ visible }) => useInstructionTyping([{ type: "paragraph", text: "四个字啊" }], true, visible),
    { initialProps: { visible: true } },
  );
  await tick(260);
  vi.setSystemTime(Date.now() + 25);
  rerender({ visible: false });
  rerender({ visible: true });
  expect(result.current.complete).toBe(true);
  expect(result.current.revealed[0].text).toBe("四个字啊");
});
