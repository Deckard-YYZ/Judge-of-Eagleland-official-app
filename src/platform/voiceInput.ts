import {
  VoiceInputError,
  VOICE_MAX_RECORDING_MS,
  VOICE_SAMPLE_RATE,
  type VoiceInferenceBackend,
  type VoiceInputRequest,
  type VoiceInputService,
} from "../shared/voiceInput";
import { getDiagnostics } from "../shared/diagnostics";

export const VOICE_PERMISSION_TIMEOUT_MS = 15000;
const SETUP_TIMEOUT_MS = 10000;
const RECOGNITION_TIMEOUT_MS = 60000;

/** Await without assuming that cancellation can stop a browser prompt or native IPC. */
function bounded<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeout: number,
  code: "PERMISSION_TIMEOUT" | "CAPTURE_FAILED" | "RECOGNITION_TIMEOUT",
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => fail(new VoiceInputError("CANCELLED"));
    const timer = setTimeout(() => fail(new VoiceInputError(code)), timeout);
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }, fail);
    if (signal.aborted) abort();
  });
}

const stopStream = (stream: MediaStream) =>
  stream.getTracks().forEach((track) => {
    if (track.readyState !== "ended") track.stop();
  });

async function capture(
  request: VoiceInputRequest,
  trackPending: (promise: Promise<unknown>) => void,
): Promise<{ samples: Float32Array; sampleRate: number }> {
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  let acceptingPermission = true;
  const cleanupListeners: (() => void)[] = [];
  try {
    request.onPhase("requesting");
    const permission = navigator.mediaDevices
      .getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      })
      .then((received) => {
        if (!acceptingPermission || request.signal.aborted) {
          stopStream(received);
          throw new VoiceInputError("CANCELLED");
        }
        // Own the resource before any await continuation can lose an abort race.
        stream = received;
        return received;
      });
    trackPending(permission);
    try {
      stream = await bounded(
        permission,
        request.signal,
        VOICE_PERMISSION_TIMEOUT_MS,
        "PERMISSION_TIMEOUT",
      );
    } finally {
      acceptingPermission = false;
    }
    if (request.signal.aborted) throw new VoiceInputError("CANCELLED");
    if (request.stopSignal.aborted)
      return { samples: new Float32Array(), sampleRate: VOICE_SAMPLE_RATE };
    context = new AudioContext();
    await bounded(
      context.audioWorklet.addModule(
        new URL("./voiceCapture.worklet.js?no-inline", import.meta.url).href,
      ),
      request.signal,
      SETUP_TIMEOUT_MS,
      "CAPTURE_FAILED",
    );
    if (request.signal.aborted) throw new VoiceInputError("CANCELLED");
    if (request.stopSignal.aborted)
      return { samples: new Float32Array(), sampleRate: context.sampleRate };
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, "voice-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const captureContext = context;
    const captureNode = node;
    const tracks = stream.getAudioTracks();
    if (!tracks.length || tracks.some((track) => track.readyState === "ended"))
      throw new VoiceInputError("DEVICE_UNAVAILABLE");
    const maxFrames = Math.floor((context.sampleRate * VOICE_MAX_RECORDING_MS) / 1000);
    if (!Number.isFinite(maxFrames) || maxFrames < 64000 || maxFrames > 1536000)
      throw new VoiceInputError("CAPTURE_FAILED");
    const samples = new Float32Array(maxFrames);
    let count = 0;
    const recorded = new Promise<Float32Array>((resolve, reject) => {
      let done = false;
      const finish = (error?: VoiceInputError) => {
        if (done) return;
        done = true;
        if (error) reject(error);
        else resolve(samples.subarray(0, count));
      };
      const abort = () => finish(new VoiceInputError("CANCELLED"));
      const disconnected = () => finish(new VoiceInputError("DEVICE_UNAVAILABLE"));
      const failed = () => finish(new VoiceInputError("CAPTURE_FAILED"));
      let stopTimer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        if (done || stopTimer) return;
        // End device capture immediately; the worklet acknowledgement drains queued PCM.
        if (stream) stopStream(stream);
        captureNode.port.postMessage("stop");
        // A stopped/broken audio thread must not leave the microphone open.
        stopTimer = setTimeout(failed, 1000);
      };
      const timer = setTimeout(stop, VOICE_MAX_RECORDING_MS);
      captureNode.port.onmessage = ({ data }: MessageEvent) => {
        if (done) return;
        if (data?.type === "done") finish();
        else if (data?.type === "samples" && data.samples instanceof Float32Array) {
          const chunk = data.samples.subarray(0, maxFrames - count);
          samples.set(chunk, count);
          count += chunk.length;
          if (count === maxFrames) finish();
        } else failed();
      };
      captureNode.addEventListener("processorerror", failed);
      request.signal.addEventListener("abort", abort, { once: true });
      request.stopSignal.addEventListener("abort", stop, { once: true });
      tracks.forEach((track) => track.addEventListener("ended", disconnected));
      const contextChanged = () => {
        if (captureContext.state !== "running") failed();
      };
      captureContext.addEventListener("statechange", contextChanged);
      cleanupListeners.push(() => {
        clearTimeout(timer);
        clearTimeout(stopTimer);
        captureNode.port.onmessage = null;
        captureNode.removeEventListener("processorerror", failed);
        request.signal.removeEventListener("abort", abort);
        request.stopSignal.removeEventListener("abort", stop);
        tracks.forEach((track) => track.removeEventListener("ended", disconnected));
        captureContext.removeEventListener("statechange", contextChanged);
      });
      if (request.signal.aborted) abort();
      if (request.stopSignal.aborted) stop();
    });
    // Observe failures during async audio startup even before awaiting recorded.
    void recorded.catch(() => undefined);
    source.connect(node);
    node.connect(context.destination);
    await bounded(context.resume(), request.signal, SETUP_TIMEOUT_MS, "CAPTURE_FAILED");
    request.onPhase("recording");
    const raw = await recorded;
    return { samples: raw, sampleRate: context.sampleRate };
  } catch (error) {
    if (error instanceof VoiceInputError) throw error;
    const name = error instanceof Error ? error.name : "";
    throw new VoiceInputError(
      name === "NotAllowedError" || name === "SecurityError"
        ? "PERMISSION_DENIED"
        : name === "NotFoundError" || name === "NotReadableError"
          ? "DEVICE_UNAVAILABLE"
          : "CAPTURE_FAILED",
      { cause: error },
    );
  } finally {
    acceptingPermission = false;
    cleanupListeners.forEach((cleanup) => cleanup());
    node?.port.close();
    node?.disconnect();
    source?.disconnect();
    if (stream) stopStream(stream);
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
  }
}

/** CPU work runs off the UI thread, after capture's finally has released the device. */
async function resample(
  samples: Float32Array,
  sampleRate: number,
  signal: AbortSignal,
): Promise<Float32Array> {
  const worker = new Worker(new URL("./voiceResample.worker.ts", import.meta.url), {
    type: "module",
  });
  try {
    const pending = new Promise<Float32Array>((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (data instanceof Float32Array && data.length <= 128000) resolve(data);
        else reject(new VoiceInputError("CAPTURE_FAILED"));
      };
      worker.onerror = () => reject(new VoiceInputError("CAPTURE_FAILED"));
      worker.onmessageerror = () => reject(new VoiceInputError("CAPTURE_FAILED"));
      worker.postMessage({ samples, sampleRate }, [samples.buffer]);
    });
    return await bounded(pending, signal, SETUP_TIMEOUT_MS, "CAPTURE_FAILED");
  } finally {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  }
}

/** One explicit recording per call. An uncancellable IPC keeps the lane occupied. */
export function createVoiceInputService(backend: VoiceInferenceBackend): VoiceInputService {
  let owner: object | null = null;
  return {
    get available() {
      return (
        backend.available &&
        typeof navigator !== "undefined" &&
        typeof navigator.mediaDevices?.getUserMedia === "function" &&
        typeof AudioContext !== "undefined" &&
        typeof AudioWorkletNode !== "undefined" &&
        typeof Worker !== "undefined"
      );
    },
    async recognize(request) {
      if (owner) throw new VoiceInputError("BUSY");
      if (request.signal.aborted) throw new VoiceInputError("CANCELLED");
      if (!this.available) throw new VoiceInputError("UNAVAILABLE");
      const attempt = {};
      owner = attempt;
      let pending = 0;
      let finished = false;
      const release = () => {
        if (finished && pending === 0 && owner === attempt) owner = null;
      };
      const trackPending = (promise: Promise<unknown>) => {
        pending++;
        const settled = () => {
          pending--;
          release();
        };
        void promise.then(settled, settled);
      };
      try {
        const raw = await capture(request, trackPending);
        if (request.signal.aborted) throw new VoiceInputError("CANCELLED");
        if (!raw.samples.length) return { type: "unknown" };
        request.onPhase("recognizing");
        const samples = await resample(raw.samples, raw.sampleRate, request.signal);
        if (request.signal.aborted) throw new VoiceInputError("CANCELLED");
        getDiagnostics().record({
          source: "voiceInput",
          event: "capture_completed",
          ...request.context,
          data: { sampleRate: VOICE_SAMPLE_RATE, sampleCount: samples.length, inputMode: "voice" },
        });
        const inference = Promise.resolve().then(() =>
          backend.infer({
            samples,
            sampleRate: VOICE_SAMPLE_RATE,
            locale: request.locale,
            signal: request.signal,
            context: request.context,
          }),
        );
        trackPending(inference);
        const result = await bounded(
          inference,
          request.signal,
          RECOGNITION_TIMEOUT_MS,
          "RECOGNITION_TIMEOUT",
        );
        if (request.signal.aborted) throw new VoiceInputError("CANCELLED");
        return result;
      } catch (error) {
        if (error instanceof VoiceInputError) throw error;
        throw new VoiceInputError("RECOGNITION_FAILED", { cause: error });
      } finally {
        finished = true;
        release();
      }
    },
  };
}
