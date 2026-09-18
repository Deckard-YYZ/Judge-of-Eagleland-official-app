import { invoke, isTauri } from "@tauri-apps/api/core";
import { isActionId } from "../shared/action";
import { getDiagnostics } from "../shared/diagnostics";
import { VoiceInputError, type VoiceInferenceBackend } from "../shared/voiceInput";
import type { RecognizedAction } from "../shared/recognizedAction";

let pendingNativeCall = false;
let pendingCancelCall = false;
const idleWaiters = new Set<() => void>();
function notifyIdle() {
  if (pendingNativeCall || pendingCancelCall) return;
  for (const resolve of idleWaiters) resolve();
  idleWaiters.clear();
}

/** Native work is bounded separately; cancel never turns a late result into a command. */
export const sherpaVoiceBackend: VoiceInferenceBackend & { whenIdle(): Promise<void> } = {
  whenIdle() {
    if (!pendingNativeCall && !pendingCancelCall) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.add(resolve));
  },
  get available() {
    return isTauri();
  },
  async infer({ samples, sampleRate, locale, signal, context }) {
    if (!isTauri()) throw new VoiceInputError("UNAVAILABLE");
    if (signal.aborted) throw new VoiceInputError("CANCELLED");
    if (pendingNativeCall || pendingCancelCall) throw new VoiceInputError("BUSY");
    if (
      sampleRate !== 16000 ||
      samples.length > 128000 ||
      samples.some((sample) => !Number.isFinite(sample) || Math.abs(sample) > 1)
    )
      throw new VoiceInputError("CAPTURE_FAILED");
    const requestId = crypto.randomUUID();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const cancel = () => {
      if (!cancelled) {
        cancelled = true;
        pendingCancelCall = true;
        void Promise.resolve()
          .then(() => invoke("voice_cancel", { requestId }))
          .catch(() => undefined)
          .finally(() => {
            pendingCancelCall = false;
            notifyIdle();
          });
      }
    };
    let abortListener: (() => void) | undefined;
    pendingNativeCall = true;
    try {
      const result = await Promise.race([
        Promise.resolve()
          .then(() => {
            if (signal.aborted) throw new VoiceInputError("CANCELLED");
            return invoke<RecognizedAction>("voice_infer", {
              requestId,
              samples: Array.from(samples),
              sampleRate,
              locale,
              operationId: context?.operationId,
            });
          })
          .finally(() => {
            pendingNativeCall = false;
            notifyIdle();
          }),
        new Promise<never>((_, reject) => {
          abortListener = () => {
            cancel();
            reject(new VoiceInputError("CANCELLED"));
          };
          signal.addEventListener("abort", abortListener, { once: true });
          if (signal.aborted) abortListener();
          timer = setTimeout(() => {
            cancel();
            reject(new VoiceInputError("RECOGNITION_TIMEOUT"));
          }, 15000);
        }),
      ]);
      if (signal.aborted) throw new VoiceInputError("CANCELLED");
      if (result?.type === "unknown") return { type: "unknown" };
      if (result?.type === "known" && isActionId(result.actionId))
        return { type: "known", actionId: result.actionId };
      throw new VoiceInputError("RECOGNITION_FAILED");
    } catch (error) {
      if (error instanceof VoiceInputError) throw error;
      const code =
        typeof error === "string" && ["BUSY", "CANCELLED", "UNAVAILABLE"].includes(error)
          ? (error as "BUSY" | "CANCELLED" | "UNAVAILABLE")
          : "RECOGNITION_FAILED";
      getDiagnostics().record({
        source: "voice",
        event: "voice.native_failed",
        level: "warn",
        ...context,
        data: { code },
      });
      throw new VoiceInputError(code);
    } finally {
      clearTimeout(timer);
      if (abortListener) signal.removeEventListener("abort", abortListener);
    }
  },
};
