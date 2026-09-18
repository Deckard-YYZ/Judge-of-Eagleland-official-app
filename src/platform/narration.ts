import { getDiagnostics } from "../shared/diagnostics";
import {
  NarrationError,
  NARRATION_MAX_CHARACTERS,
  NARRATION_TIMEOUT_MS,
  type NarrationBackend,
  type NarrationOutcome,
  type NarrationPlayer,
  type NarrationService,
} from "../shared/narration";
import type { AudioOccupancy } from "./audioOccupancy";
import { validNarrationAudio } from "./narrationPlayer";

/** No queue: cancellation invalidates output immediately, while native work retains its slot. */
export function createNarrationService(
  backend: NarrationBackend,
  player: NarrationPlayer,
  occupancy: AudioOccupancy,
): NarrationService {
  let active: { requestId: string; stop: () => Promise<void> } | null = null;
  return {
    get available() {
      return backend.available && player.available;
    },
    async stop(requestId) {
      if (active?.requestId === requestId) await active.stop();
    },
    async speak(request) {
      if (request.signal.aborted) return { type: "cancelled" };
      if (!this.available) return { type: "failed", code: "UNAVAILABLE" };
      if (
        !request.requestId ||
        request.requestId.length > 100 ||
        request.text.includes("\0") ||
        !request.text.trim() ||
        Array.from(request.text).length > NARRATION_MAX_CHARACTERS ||
        request.voiceId !== "system" ||
        !["zh-CN", "en-US"].includes(request.locale)
      )
        return { type: "failed", code: "INVALID_REQUEST" };
      if (active) return { type: "failed", code: "BUSY" };
      const started = performance.now();
      const record = (event: string, data: Record<string, unknown> = {}) =>
        getDiagnostics().record({
          source: "narration",
          event: `narration.${event}`,
          ...request.context,
          data: {
            requestId: request.requestId,
            voiceId: request.voiceId,
            locale: request.locale,
            textLength: Array.from(request.text).length,
            durationMs: Math.round(performance.now() - started),
            ...data,
          },
        });
      record("requested");
      const controller = new AbortController();
      let pending = false;
      let returned = false;
      let silent = true;
      let cancel!: () => void;
      const cancelled = new Promise<never>((_, reject) => {
        cancel = () => reject(new NarrationError("CANCELLED"));
      });
      void cancelled.catch(() => undefined);
      const owned = {
        requestId: request.requestId,
        async stop() {
          controller.abort();
          cancel();
          await player.stop();
          silent = true;
          release();
        },
      };
      const release = () => {
        if (returned && !pending && silent && active === owned) {
          active = null;
          occupancy.releaseNarration(owned);
        }
      };
      if (!occupancy.reserveNarration(owned, owned.stop)) return { type: "failed", code: "BUSY" };
      active = owned;
      const abort = () => {
        void owned.stop().catch(() => undefined);
      };
      request.signal.addEventListener("abort", abort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new NarrationError("TIMEOUT"));
          abort();
        }, NARRATION_TIMEOUT_MS);
      });
      let outcome: NarrationOutcome;
      try {
        request.onPhase?.("preparing");
        record("synthesis_started");
        pending = true;
        const synthesis = Promise.resolve()
          .then(() => {
            if (controller.signal.aborted) throw new NarrationError("CANCELLED");
            return backend.synthesize({ ...request, signal: controller.signal });
          })
          .finally(() => {
            pending = false;
            release();
          });
        const audio = await Promise.race([synthesis, cancelled, timeout]);
        if (controller.signal.aborted) throw new NarrationError("CANCELLED");
        if (!validNarrationAudio(audio)) throw new NarrationError("SYNTHESIS_FAILED");
        record("synthesis_finished", {
          sampleCount: audio.samples.length,
          sampleRate: audio.sampleRate,
          audioDurationMs: Math.round((audio.samples.length / audio.sampleRate) * 1000),
        });
        silent = false;
        await Promise.race([
          player.play(audio, controller.signal, () => {
            record("playback_started");
            request.onPhase?.("playing");
          }),
          cancelled,
          timeout,
        ]);
        outcome = controller.signal.aborted ? { type: "cancelled" } : { type: "ended" };
      } catch (error) {
        const code =
          error instanceof NarrationError
            ? error.code
            : silent
              ? "SYNTHESIS_FAILED"
              : "PLAYBACK_FAILED";
        outcome = code === "CANCELLED" ? { type: "cancelled" } : { type: "failed", code };
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", abort);
        try {
          await owned.stop();
        } catch {
          silent = false;
          outcome = { type: "failed", code: "PLAYBACK_FAILED" };
        }
        returned = true;
        release();
      }
      record(
        outcome.type === "ended" ? "playback_ended" : outcome.type,
        outcome.type === "failed" ? { code: outcome.code } : {},
      );
      return outcome;
    },
  };
}
