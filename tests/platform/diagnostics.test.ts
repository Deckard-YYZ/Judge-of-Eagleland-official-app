import { afterEach, describe, expect, it, vi } from "vitest";
import { configureDiagnostics, getDiagnostics } from "../../src/shared/diagnostics";
import {
  createDiagnosticTransport,
  sanitizeDiagnostic,
  type DiagnosticRecord,
} from "../../src/platform/diagnostics";

const identity = { runId: "run-1", buildId: "build-1", development: false };
afterEach(() => {
  configureDiagnostics(() => undefined);
  vi.useRealTimers();
});

describe("diagnostic failure isolation", () => {
  it("does not execute Error accessors and expires detail on monotonic time", async () => {
    const getter = vi.fn(() => "private");
    const error = new Error("safe");
    Object.defineProperties(error, { message: { get: getter }, cause: { get: getter } });
    expect(JSON.stringify(sanitizeDiagnostic(error))).not.toContain("private");
    expect(getter).not.toHaveBeenCalled();
    let time = 100;
    vi.spyOn(performance, "now").mockImplementation(() => time);
    const send = vi.fn(async () => undefined);
    const transport = createDiagnosticTransport(identity, send);
    transport.record({ source: "test", event: "hidden", level: "debug" });
    expect(send).not.toHaveBeenCalled();
    transport.setDetailed(true);
    transport.record({ source: "test", event: "visible", level: "debug" });
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    time += 300_001;
    transport.record({ source: "test", event: "expired", level: "debug" });
    expect(transport.snapshot().level).toBe("info");
    expect(send).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
  it("keeps a broken observer outside business outcomes", () => {
    configureDiagnostics(() => {
      throw new Error("sink failed");
    });
    expect(() => getDiagnostics().record({ source: "test", event: "test" })).not.toThrow();
    expect(getDiagnostics().operationId()).not.toBe(getDiagnostics().operationId());
  });

  it("bounds pending IPC and queue, then exposes unavailable after timeout", async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => new Promise<void>(() => undefined));
    const transport = createDiagnosticTransport(identity, send, 2, 10);
    for (let i = 0; i < 5; i++) transport.record({ source: "test", event: "test" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(transport.status().queued).toBe(2);
    expect(transport.status().dropped).toBe(2);
    await vi.advanceTimersByTimeAsync(11);
    expect(transport.status()).toMatchObject({
      unavailable: true,
      failures: 1,
      dropped: 5,
      queued: 0,
    });
    transport.record({ source: "test", event: "test" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("projects summary keys and retains safe error cause/code without raw player text", async () => {
    const records: DiagnosticRecord[] = [];
    const transport = createDiagnosticTransport(identity, async (batch) => {
      records.push(...batch);
    });
    const cause = Object.assign(new Error("sqlite failed"), { code: "SQLITE_BUSY" });
    const error = new Error("C:\\Users\\Alice\\game token=secret", { cause });
    transport.record({
      source: "storage",
      event: "save.failed",
      data: {
        revision: 4,
        sampleRate: 16000,
        sampleCount: 1600,
        modelId: "test-kws",
        inputMode: "voice",
        samples: [0.1, 0.2],
        text: "private",
        save: { private: true },
      },
      error,
    });
    await Promise.resolve();
    expect(records[0].data).toEqual({
      revision: 4,
      sampleRate: 16000,
      sampleCount: 1600,
      modelId: "test-kws",
      inputMode: "voice",
    });
    expect(JSON.stringify(records)).not.toContain("Alice");
    expect(JSON.stringify(records)).not.toContain("secret");
    expect(JSON.stringify(records)).toContain("SQLITE_BUSY");
  });

  it("survives hostile getters and cyclic error causes with a bounded output", () => {
    const error = new Error();
    Object.defineProperty(error, "message", {
      get() {
        throw new Error("getter");
      },
    });
    error.cause = error;
    expect(sanitizeDiagnostic(error)).toMatchObject({
      message: "[unreadable]",
      cause: "[truncated]",
    });
    const many = Object.fromEntries(
      Array.from({ length: 24 }, (_, i) => [i, Array(16).fill("x".repeat(2048))]),
    );
    expect(JSON.stringify(sanitizeDiagnostic(many)).length).toBeLessThan(18000);
  });
});
