import { invoke, isTauri } from "@tauri-apps/api/core";
import { NarrationError, type NarrationBackend } from "../shared/narration";

let occupied = false;
/** Keep the native slot until synthesis and cancellation IPC both settle. */
export const sherpaNarrationBackend: NarrationBackend = {
  get available() {
    return isTauri();
  },
  async synthesize(request) {
    if (!isTauri()) throw new NarrationError("UNAVAILABLE");
    if (request.signal.aborted) throw new NarrationError("CANCELLED");
    if (occupied) throw new NarrationError("BUSY");
    occupied = true;
    let cancellation: Promise<unknown> | undefined;
    const cancel = () => {
      cancellation ??= Promise.resolve()
        .then(() => invoke("narration_cancel", { requestId: request.requestId }))
        .catch(() => undefined);
    };
    request.signal.addEventListener("abort", cancel, { once: true });
    try {
      const result = await invoke<{ samples: number[]; sampleRate: number }>(
        "narration_synthesize",
        {
          requestId: request.requestId,
          text: request.text,
          locale: request.locale,
          voiceId: request.voiceId,
          operationId: request.context?.operationId,
        },
      );
      if (request.signal.aborted) throw new NarrationError("CANCELLED");
      if (
        !result ||
        !Number.isInteger(result.sampleRate) ||
        result.sampleRate < 8000 ||
        result.sampleRate > 48000 ||
        !Array.isArray(result.samples) ||
        !result.samples.length ||
        result.samples.length > result.sampleRate * 30 ||
        result.samples.some((v) => typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1)
      )
        throw new NarrationError("SYNTHESIS_FAILED");
      return { samples: Float32Array.from(result.samples), sampleRate: result.sampleRate };
    } catch (error) {
      if (error instanceof NarrationError) throw error;
      const known = [
        "CANCELLED",
        "BUSY",
        "UNAVAILABLE",
        "INVALID_REQUEST",
        "SYNTHESIS_FAILED",
        "TIMEOUT",
      ] as const;
      throw new NarrationError(known.find((code) => code === error) ?? "SYNTHESIS_FAILED");
    } finally {
      request.signal.removeEventListener("abort", cancel);
      await cancellation;
      occupied = false;
    }
  },
};
