import { afterEach, expect, it, vi } from "vitest";
import { createAudioOccupancy } from "../../src/platform/audioOccupancy";
import { createNarrationService } from "../../src/platform/narration";
import {
  NarrationError,
  type NarrationRequest,
  type SynthesizedSpeech,
} from "../../src/shared/narration";
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const request = (id = "one"): NarrationRequest => ({
  requestId: id,
  text: "Hello",
  locale: "en-US",
  voiceId: "system",
  signal: new AbortController().signal,
});
const audio = { samples: new Float32Array([0, 0.1, 0]), sampleRate: 16000 };
const setup = () => {
  const synthesis = deferred<SynthesizedSpeech>();
  const playback = deferred<void>();
  const backend = { available: true, synthesize: vi.fn(() => synthesis.promise) };
  const player = {
    available: true,
    play: vi.fn(
      (_audio: SynthesizedSpeech, _signal: AbortSignal, _onPlaying: () => void) => playback.promise,
    ),
    stop: vi.fn(async () => undefined),
  };
  const occupancy = createAudioOccupancy(0);
  const service = createNarrationService(backend, player, occupancy);
  return { synthesis, playback, backend, player, occupancy, service };
};
afterEach(() => vi.useRealTimers());
it("ended waits for actual playback; stale stop cannot cancel the current request", async () => {
  const x = setup();
  let settled = false;
  const pending = x.service.speak(request()).then((v) => {
    settled = true;
    return v;
  });
  x.synthesis.resolve(audio);
  await flush();
  expect(x.player.play).toHaveBeenCalledOnce();
  expect(settled).toBe(false);
  await x.service.stop("old");
  expect(x.player.stop).not.toHaveBeenCalled();
  x.playback.resolve();
  expect(await pending).toEqual({ type: "ended" });
});
it("stop invalidates late PCM and retains the synthesis slot until real completion", async () => {
  const x = setup();
  const pending = x.service.speak(request());
  await flush();
  await x.service.stop("one");
  expect(await pending).toEqual({ type: "cancelled" });
  expect(await x.service.speak(request("two"))).toEqual({ type: "failed", code: "BUSY" });
  x.synthesis.resolve(audio);
  await flush();
  expect(x.player.play).not.toHaveBeenCalled();
  const next = x.service.speak(request("three"));
  await flush();
  x.playback.resolve();
  expect(await next).toEqual({ type: "ended" });
});
it("timeout returns a stable code but cannot release in-flight synthesis", async () => {
  vi.useFakeTimers();
  const x = setup();
  const pending = x.service.speak(request());
  await vi.advanceTimersByTimeAsync(60000);
  expect(await pending).toEqual({ type: "failed", code: "TIMEOUT" });
  expect(await x.service.speak(request("two"))).toEqual({ type: "failed", code: "BUSY" });
  x.synthesis.resolve(audio);
  await flush();
  expect(x.player.play).not.toHaveBeenCalled();
});
it("input reservation closes the stop-to-microphone race and blocks replay until release", async () => {
  vi.useFakeTimers();
  const x = setup();
  const pending = x.service.speak(request());
  await flush();
  const input = x.occupancy.reserveInput()!;
  const prepare = input.prepare();
  expect(await x.service.speak(request("two"))).toEqual({ type: "failed", code: "BUSY" });
  await vi.advanceTimersByTimeAsync(1);
  await prepare;
  expect(await pending).toEqual({ type: "cancelled" });
  x.synthesis.resolve(audio);
  await flush();
  expect(await x.service.speak(request("three"))).toEqual({ type: "failed", code: "BUSY" });
  input.release();
});
it("failed output stop rejects microphone preparation and retains output ownership", async () => {
  const x = setup();
  const pending = x.service.speak(request());
  x.synthesis.resolve(audio);
  await flush();
  x.player.stop.mockRejectedValue(new NarrationError("PLAYBACK_FAILED"));
  const input = x.occupancy.reserveInput()!;
  await expect(input.prepare()).rejects.toMatchObject({ code: "PLAYBACK_FAILED" });
  await pending;
  input.release();
  expect(await x.service.speak(request("two"))).toEqual({ type: "failed", code: "BUSY" });
});
it.each([NaN, Infinity, 1.1])("rejects invalid PCM %s before playing", async (value) => {
  const x = setup();
  const pending = x.service.speak(request());
  x.synthesis.resolve({ ...audio, samples: new Float32Array([value]) });
  expect(await pending).toEqual({ type: "failed", code: "SYNTHESIS_FAILED" });
  expect(x.player.play).not.toHaveBeenCalled();
});
it("maps browser playback refusal and validates bounded text", async () => {
  const x = setup();
  expect(await x.service.speak({ ...request(), text: "a".repeat(501) })).toEqual({
    type: "failed",
    code: "INVALID_REQUEST",
  });
  x.player.play.mockRejectedValue(new NarrationError("AUTOPLAY_BLOCKED"));
  const pending = x.service.speak(request());
  x.synthesis.resolve(audio);
  expect(await pending).toEqual({ type: "failed", code: "AUTOPLAY_BLOCKED" });
});
it("diagnostics describe phases and bounded metadata without narration text", async () => {
  const { configureDiagnostics } = await import("../../src/shared/diagnostics");
  const events: unknown[] = [];
  configureDiagnostics((event) => events.push(event));
  try {
    const x = setup();
    const onPhase = vi.fn();
    x.player.play.mockImplementation(async (_audio, _signal, onPlaying) => {
      onPlaying();
    });
    const pending = x.service.speak({ ...request(), text: "private story narration", onPhase });
    x.synthesis.resolve(audio);
    await pending;
    const json = JSON.stringify(events);
    expect(json).not.toContain("private story narration");
    for (const phase of [
      "requested",
      "synthesis_started",
      "synthesis_finished",
      "playback_started",
      "playback_ended",
    ])
      expect(json).toContain(`narration.${phase}`);
    expect(json).toContain("textLength");
  } finally {
    configureDiagnostics(() => undefined);
  }
});
it.each([{ requestId: "x".repeat(101) }, { text: "hello\0world" }])(
  "rejects incompatible native request bounds",
  async (override) => {
    const x = setup();
    expect(await x.service.speak({ ...request(), ...override })).toEqual({
      type: "failed",
      code: "INVALID_REQUEST",
    });
    expect(x.backend.synthesize).not.toHaveBeenCalled();
  },
);
