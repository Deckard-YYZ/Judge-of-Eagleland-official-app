// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { startDiagnosticHeartbeat } from "../../src/platform/diagnosticHeartbeat";

afterEach(() => vi.useRealTimers());

describe("diagnostic heartbeat", () => {
  it("never accumulates IPC calls when the host stops answering", async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => new Promise(() => {}));
    const heartbeat = startDiagnosticHeartbeat(send, () => true, 20, 50);
    await vi.advanceTimersByTimeAsync(200);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(heartbeat.status()).toEqual({ stopped: true, pending: true, degraded: true });
  });

  it("reports visibility and isolates synchronous transport failure", async () => {
    vi.useFakeTimers();
    let visible = true;
    const send = vi.fn().mockResolvedValue(undefined);
    const heartbeat = startDiagnosticHeartbeat(send, () => visible, 20, 50);
    await vi.advanceTimersByTimeAsync(1);
    visible = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(1);
    expect(send.mock.calls).toEqual([[true], [false]]);
    heartbeat.stop();
    const broken = startDiagnosticHeartbeat(
      () => {
        throw new Error("unavailable");
      },
      () => true,
      20,
      50,
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(broken.status()).toEqual({ stopped: true, pending: false, degraded: true });
  });
});
