import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVoiceInputService,
  VOICE_PERMISSION_TIMEOUT_MS,
} from "../../src/platform/voiceInput";
import type { VoiceInferenceBackend, VoiceInputRequest } from "../../src/shared/voiceInput";
import type { RecognizedAction } from "../../src/shared/recognizedAction";
import { resampleVoicePcm } from "../../src/platform/pcmAudio";
import { configureDiagnostics, type DiagnosticEvent } from "../../src/shared/diagnostics";

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
class Track extends EventTarget {
  readyState = "live";
  stop = vi.fn(() => {
    this.readyState = "ended";
  });
}
class Context extends EventTarget {
  static latest: Context;
  sampleRate = 48000;
  state = "suspended";
  destination = {};
  source = { connect: vi.fn(), disconnect: vi.fn() };
  audioWorklet = { addModule: vi.fn(async () => undefined) };
  constructor() {
    super();
    Context.latest = this;
  }
  createMediaStreamSource() {
    return this.source;
  }
  resume = vi.fn(async () => {
    this.state = "running";
    this.dispatchEvent(new Event("statechange"));
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
}
class Worklet extends EventTarget {
  static latest: Worklet;
  port = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: vi.fn(() => {
      this.emit({ type: "done" });
    }),
    close: vi.fn(),
  };
  constructor() {
    super();
    Worklet.latest = this;
  }
  connect = vi.fn();
  disconnect = vi.fn();
  emit(data: unknown) {
    this.port.onmessage?.({ data });
  }
}
class ResampleWorker {
  static latest: ResampleWorker;
  onmessage: ((event: { data: Float32Array }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor() {
    ResampleWorker.latest = this;
  }
  postMessage({ samples, sampleRate }: { samples: Float32Array; sampleRate: number }) {
    expect(track.stop).toHaveBeenCalledOnce();
    void Promise.resolve().then(() =>
      this.onmessage?.({ data: resampleVoicePcm(samples, sampleRate) }),
    );
  }
  terminate = vi.fn();
}
function request() {
  const cancel = new AbortController();
  const stop = new AbortController();
  const options: VoiceInputRequest = {
    locale: "zh-CN",
    signal: cancel.signal,
    stopSignal: stop.signal,
    onPhase: vi.fn(),
  };
  return { cancel, stop, options };
}
let track: Track;
let stream: MediaStream;
let getUserMedia: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  track = new Track();
  stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("AudioWorkletNode", Worklet);
  vi.stubGlobal("Worker", ResampleWorker);
});
afterEach(() => {
  configureDiagnostics(() => undefined);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function backend() {
  return {
    available: true,
    infer: vi.fn(async (): Promise<RecognizedAction> => ({ type: "known", actionId: "salute" })),
  } satisfies VoiceInferenceBackend;
}

describe("explicit bounded voice capture", () => {
  it("observes pre/post resampling and tolerates unavailable track settings", async () => {
    Object.defineProperty(track, "getSettings", {
      value: () => {
        throw new Error("unsupported settings");
      },
    });
    const records: DiagnosticEvent[] = [];
    configureDiagnostics((event) => records.push(event));
    const engine = backend();
    const attempt = request();
    const result = createVoiceInputService(engine).recognize(attempt.options);
    await flush();
    Worklet.latest.emit({ type: "samples", samples: new Float32Array(4800).fill(0.25) });
    attempt.stop.abort();
    await expect(result).resolves.toEqual({ type: "known", actionId: "salute" });
    expect(records.find((record) => record.event === "voice.pcm_captured")?.data).toMatchObject({
      sampleRate: 48000,
      sampleCount: 4800,
      rms: 0.25,
    });
    expect(records.find((record) => record.event === "voice.pcm_resampled")?.data).toMatchObject({
      sampleRate: 16000,
      sampleCount: 1600,
    });
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it("explains an empty capture without invoking native recognition", async () => {
    const records: DiagnosticEvent[] = [];
    configureDiagnostics((event) => records.push(event));
    const engine = backend();
    const attempt = request();
    const result = createVoiceInputService(engine).recognize(attempt.options);
    await flush();
    attempt.stop.abort();
    await expect(result).resolves.toEqual({ type: "unknown" });
    expect(records.find((record) => record.event === "voice.capture_unknown")?.data).toEqual({
      unknownReason: "empty_audio",
    });
    expect(engine.infer).not.toHaveBeenCalled();
  });
  it("does not acquire devices during construction or capability checks", () => {
    expect(createVoiceInputService(backend()).available).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it("stops once, resamples actual PCM, and cleans all capture resources before inference", async () => {
    const engine = backend();
    const service = createVoiceInputService(engine);
    const { options, stop } = request();
    const result = service.recognize(options);
    await flush();
    Worklet.latest.emit({ type: "samples", samples: new Float32Array(4800).fill(0.25) });
    stop.abort();
    await expect(result).resolves.toEqual({ type: "known", actionId: "salute" });
    expect(options.onPhase).toHaveBeenNthCalledWith(1, "requesting");
    expect(options.onPhase).toHaveBeenNthCalledWith(2, "recording");
    expect(options.onPhase).toHaveBeenNthCalledWith(3, "recognizing");
    expect(engine.infer).toHaveBeenCalledOnce();
    expect(engine.infer.mock.calls[0]).toBeDefined();
    const input = (
      engine.infer.mock.calls as unknown as [[{ samples: Float32Array; sampleRate: number }]]
    )[0][0];
    expect(input.sampleRate).toBe(16000);
    expect(input.samples.length).toBe(1600);
    expect(input.samples[800]).toBeCloseTo(0.25);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(Context.latest.close).toHaveBeenCalledOnce();
    expect(Context.latest.source.disconnect).toHaveBeenCalledOnce();
    expect(Worklet.latest.port.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["cancel", "timeout"] as const)("releases late permission after %s", async (mode) => {
    const permission = deferred<MediaStream>();
    getUserMedia.mockReturnValue(permission.promise);
    const attempt = request();
    const service = createVoiceInputService(backend());
    const result = service.recognize(attempt.options);
    const failed = expect(result).rejects.toMatchObject({
      code: mode === "cancel" ? "CANCELLED" : "PERMISSION_TIMEOUT",
    });
    if (mode === "cancel") attempt.cancel.abort();
    else await vi.advanceTimersByTimeAsync(VOICE_PERMISSION_TIMEOUT_MS);
    await failed;
    await expect(service.recognize(request().options)).rejects.toMatchObject({ code: "BUSY" });
    expect(getUserMedia).toHaveBeenCalledOnce();
    permission.resolve(stream);
    await flush();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ends at eight seconds with bounded samples", async () => {
    const engine = backend();
    const pending = createVoiceInputService(engine).recognize(request().options);
    await flush();
    Worklet.latest.emit({ type: "samples", samples: new Float32Array(480) });
    await vi.advanceTimersByTimeAsync(8000);
    await pending;
    expect(Worklet.latest.port.postMessage).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
  });
  it("owns a granted stream before the awaiting continuation races with cancellation", async () => {
    const permission = deferred<MediaStream>();
    getUserMedia.mockReturnValue(permission.promise);
    const attempt = request();
    const pending = createVoiceInputService(backend()).recognize(attempt.options);
    const failed = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    permission.resolve(stream);
    // permission.then has run; the bounded promise continuation has not.
    await Promise.resolve();
    attempt.cancel.abort();
    await failed;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("terminates resampling on cancellation after releasing the microphone", async () => {
    vi.spyOn(ResampleWorker.prototype, "postMessage").mockImplementationOnce(() => undefined);
    const engine = backend();
    const service = createVoiceInputService(engine);
    const attempt = request();
    const pending = service.recognize(attempt.options);
    await flush();
    Worklet.latest.emit({ type: "samples", samples: new Float32Array(4800) });
    attempt.stop.abort();
    await flush();
    expect(track.stop).toHaveBeenCalledOnce();
    const failed = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    attempt.cancel.abort();
    await failed;
    expect(ResampleWorker.latest.terminate).toHaveBeenCalledOnce();
    expect(engine.infer).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("maps permission rejection without starting audio capture", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    await expect(
      createVoiceInputService(backend()).recognize(request().options),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(track.stop).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("times out inference while retaining the lane until the native promise settles", async () => {
    const inference = deferred<RecognizedAction>();
    const service = createVoiceInputService({ available: true, infer: () => inference.promise });
    const attempt = request();
    const pending = service.recognize(attempt.options);
    const failed = expect(pending).rejects.toMatchObject({ code: "RECOGNITION_TIMEOUT" });
    await flush();
    Worklet.latest.emit({ type: "samples", samples: new Float32Array(480) });
    attempt.stop.abort();
    await flush();
    await vi.advanceTimersByTimeAsync(60000);
    await failed;
    await expect(service.recognize(request().options)).rejects.toMatchObject({ code: "BUSY" });
    inference.resolve({ type: "unknown" });
    await flush();
    const next = request();
    next.stop.abort();
    await expect(service.recognize(next.options)).resolves.toEqual({ type: "unknown" });
  });
  it.each(["device", "processor", "context", "cancel"] as const)(
    "cleans up on %s failure without inference",
    async (reason) => {
      const engine = backend();
      const attempt = request();
      const pending = createVoiceInputService(engine).recognize(attempt.options);
      const failed = expect(pending).rejects.toMatchObject({
        code:
          reason === "device"
            ? "DEVICE_UNAVAILABLE"
            : reason === "cancel"
              ? "CANCELLED"
              : "CAPTURE_FAILED",
      });
      await flush();
      if (reason === "device") track.dispatchEvent(new Event("ended"));
      else if (reason === "processor") Worklet.latest.dispatchEvent(new Event("processorerror"));
      else if (reason === "cancel") attempt.cancel.abort();
      else {
        Context.latest.state = "suspended";
        Context.latest.dispatchEvent(new Event("statechange"));
      }
      await failed;
      expect(engine.infer).not.toHaveBeenCalled();
      expect(track.stop).toHaveBeenCalledOnce();
      expect(Worklet.latest.port.onmessage).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("retains the IPC lane after cancellation until native settlement", async () => {
    const inference = deferred<RecognizedAction>();
    const engine = { available: true, infer: vi.fn(() => inference.promise) };
    const service = createVoiceInputService(engine);
    const attempt = request();
    const pending = service.recognize(attempt.options);
    await flush();
    Worklet.latest.emit({ type: "samples", samples: new Float32Array(480) });
    attempt.stop.abort();
    await flush();
    const failed = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    attempt.cancel.abort();
    await failed;
    await expect(service.recognize(request().options)).rejects.toMatchObject({ code: "BUSY" });
    expect(getUserMedia).toHaveBeenCalledOnce();
    inference.resolve({ type: "known", actionId: "wave" });
    await flush();
    const next = request();
    next.stop.abort();
    await expect(service.recognize(next.options)).resolves.toEqual({ type: "unknown" });
    expect(engine.infer).toHaveBeenCalledOnce();
  });
});
