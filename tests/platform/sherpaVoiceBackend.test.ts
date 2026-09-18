import { afterEach, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: mocked.invoke }));
afterEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  mocked.invoke.mockReset();
});
const request = (signal = new AbortController().signal) => ({
  samples: new Float32Array(16000),
  sampleRate: 16000 as const,
  locale: "zh-CN" as const,
  signal,
});
it("holds the native slot after cancellation until the real invocation settles", async () => {
  let resolveNative: (value: unknown) => void = () => undefined;
  mocked.invoke.mockImplementation((command) =>
    command === "voice_infer"
      ? new Promise((resolve) => {
          resolveNative = resolve;
        })
      : Promise.resolve(),
  );
  const { sherpaVoiceBackend } = await import("../../src/platform/sherpaVoiceBackend");
  const abort = new AbortController();
  const pending = sherpaVoiceBackend.infer(request(abort.signal)).catch((error) => error);
  await Promise.resolve();
  abort.abort();
  expect(await pending).toMatchObject({ code: "CANCELLED" });
  await expect(sherpaVoiceBackend.infer(request())).rejects.toMatchObject({ code: "BUSY" });
  expect(mocked.invoke.mock.calls.filter(([name]) => name === "voice_infer")).toHaveLength(1);
  resolveNative({ type: "known", actionId: "salute" });
  await Promise.resolve();
  await Promise.resolve();
});
it("keeps timed-out IPC bounded and rejects invalid PCM before native work", async () => {
  vi.useFakeTimers();
  mocked.invoke.mockImplementation(() => new Promise(() => undefined));
  const { sherpaVoiceBackend } = await import("../../src/platform/sherpaVoiceBackend");
  await expect(
    sherpaVoiceBackend.infer({ ...request(), samples: new Float32Array([NaN]) }),
  ).rejects.toMatchObject({ code: "CAPTURE_FAILED" });
  expect(mocked.invoke).not.toHaveBeenCalled();
  const pending = sherpaVoiceBackend.infer(request()).catch((error) => error);
  await vi.advanceTimersByTimeAsync(15001);
  expect(await pending).toMatchObject({ code: "RECOGNITION_TIMEOUT" });
  await expect(sherpaVoiceBackend.infer(request())).rejects.toMatchObject({ code: "BUSY" });
  expect(mocked.invoke.mock.calls.filter(([name]) => name === "voice_infer")).toHaveLength(1);
});
it("rejects cancellation before queued invocation and unrecognized native labels", async () => {
  mocked.invoke.mockResolvedValue({ type: "known", actionId: "invented" });
  const { sherpaVoiceBackend } = await import("../../src/platform/sherpaVoiceBackend");
  const abort = new AbortController();
  const pending = sherpaVoiceBackend.infer(request(abort.signal));
  abort.abort();
  await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  expect(mocked.invoke.mock.calls.filter(([name]) => name === "voice_infer")).toHaveLength(0);
  await Promise.resolve();
  await Promise.resolve();
  await expect(sherpaVoiceBackend.infer(request())).rejects.toMatchObject({
    code: "RECOGNITION_FAILED",
  });
});
it("whenIdle waits for both native inference and cancel acknowledgement", async () => {
  let finishNative!: (value: unknown) => void;
  let finishCancel!: (value: unknown) => void;
  mocked.invoke.mockImplementation(
    (name) =>
      new Promise((resolve) => {
        if (name === "voice_infer") finishNative = resolve;
        else finishCancel = resolve;
      }),
  );
  const { sherpaVoiceBackend } = await import("../../src/platform/sherpaVoiceBackend");
  const abort = new AbortController();
  const pending = sherpaVoiceBackend.infer(request(abort.signal)).catch((e) => e);
  await Promise.resolve();
  abort.abort();
  await pending;
  let idle = false;
  const drained = sherpaVoiceBackend.whenIdle().then(() => {
    idle = true;
  });
  finishNative({ type: "unknown" });
  await Promise.resolve();
  await Promise.resolve();
  expect(idle).toBe(false);
  finishCancel(undefined);
  await drained;
  expect(idle).toBe(true);
});
