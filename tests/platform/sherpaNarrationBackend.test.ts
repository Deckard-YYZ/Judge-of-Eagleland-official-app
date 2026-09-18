import { afterEach, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: mocked.invoke }));
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const request = () => ({
  requestId: "tts-one",
  text: "Hello",
  locale: "en-US" as const,
  voiceId: "system" as const,
  signal: new AbortController().signal,
});
afterEach(() => {
  vi.resetModules();
  mocked.invoke.mockReset();
});
it("keeps synthesis pending through cancellation and cancel acknowledgement", async () => {
  const synthesis = deferred<unknown>();
  const cancellation = deferred<unknown>();
  mocked.invoke.mockImplementation((name) =>
    name === "narration_synthesize" ? synthesis.promise : cancellation.promise,
  );
  const { sherpaNarrationBackend: b } = await import("../../src/platform/sherpaNarrationBackend");
  const abort = new AbortController();
  const pending = b.synthesize({ ...request(), signal: abort.signal });
  const failed = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  abort.abort();
  await Promise.resolve();
  expect(mocked.invoke).toHaveBeenCalledWith("narration_cancel", { requestId: "tts-one" });
  synthesis.resolve({ samples: [0], sampleRate: 16000 });
  await Promise.resolve();
  await expect(b.synthesize(request())).rejects.toMatchObject({ code: "BUSY" });
  cancellation.resolve(undefined);
  await failed;
});
it.each([
  { samples: [NaN], sampleRate: 16000 },
  { samples: [2], sampleRate: 16000 },
  { samples: [], sampleRate: 16000 },
  { samples: [0], sampleRate: 7999 },
  { samples: new Array(240001).fill(0), sampleRate: 8000 },
])("rejects invalid or oversized IPC audio", async (audio) => {
  mocked.invoke.mockResolvedValue(audio);
  const { sherpaNarrationBackend: b } = await import("../../src/platform/sherpaNarrationBackend");
  await expect(b.synthesize(request())).rejects.toMatchObject({ code: "SYNTHESIS_FAILED" });
});
it("maps stable native errors without leaking their raw message", async () => {
  mocked.invoke.mockRejectedValue("UNAVAILABLE");
  const { sherpaNarrationBackend: b } = await import("../../src/platform/sherpaNarrationBackend");
  await expect(b.synthesize(request())).rejects.toMatchObject({ code: "UNAVAILABLE" });
  mocked.invoke.mockRejectedValue("private path");
  await expect(b.synthesize(request())).rejects.toMatchObject({ code: "SYNTHESIS_FAILED" });
});
