import { NarrationError, type NarrationPlayer, type SynthesizedSpeech } from "../shared/narration";

export function validNarrationAudio(audio: SynthesizedSpeech): boolean {
  return (
    Number.isInteger(audio.sampleRate) &&
    audio.sampleRate >= 8000 &&
    audio.sampleRate <= 48000 &&
    audio.samples instanceof Float32Array &&
    audio.samples.length > 0 &&
    audio.samples.length <= audio.sampleRate * 30 &&
    !audio.samples.some((v) => !Number.isFinite(v) || Math.abs(v) > 1)
  );
}
/** The sole output path. Disconnect is the synchronous silence boundary, not context state. */
export function createWebAudioNarrationPlayer(): NarrationPlayer {
  let current: { stop: () => Promise<void> } | null = null;
  return {
    get available() {
      return typeof AudioContext !== "undefined";
    },
    async stop() {
      await current?.stop();
    },
    async play(audio, signal, onPlaying) {
      if (current) throw new NarrationError("BUSY");
      if (signal.aborted) throw new NarrationError("CANCELLED");
      if (!validNarrationAudio(audio)) throw new NarrationError("SYNTHESIS_FAILED");
      let context: AudioContext;
      try {
        context = new AudioContext();
      } catch {
        throw new NarrationError("PLAYBACK_FAILED");
      }
      let disposed = false;
      let source: AudioBufferSourceNode | undefined;
      let finished = false;
      let settle!: (error?: unknown) => void;
      const completion = new Promise<void>((resolve, reject) => {
        settle = (error) => {
          if (finished) return;
          finished = true;
          if (error) reject(error);
          else resolve();
        };
      });
      // Resume may fail before the completion promise is awaited.
      void completion.catch(() => undefined);
      const owned = {
        async stop() {
          if (disposed) return;
          // Never report silence if disconnect fails. The caller must keep capture closed.
          try {
            source?.disconnect();
          } catch {
            throw new NarrationError("PLAYBACK_FAILED");
          }
          try {
            source?.stop();
          } catch {
            /* A disconnected, already-ended node is silent. */
          }
          settle(new NarrationError("CANCELLED"));
          disposed = true;
          if (current === owned) current = null;
          void context.close().catch(() => undefined);
        },
      };
      current = owned;
      const abort = () => {
        void owned.stop().catch((error) => settle(error));
      };
      signal.addEventListener("abort", abort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const buffer = context.createBuffer(1, audio.samples.length, audio.sampleRate);
        buffer.copyToChannel(new Float32Array(audio.samples), 0);
        source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.onended = () => settle();
        timer = setTimeout(
          () => settle(new NarrationError("TIMEOUT")),
          (audio.samples.length / audio.sampleRate) * 1000 + 5000,
        );
        await Promise.race([context.resume(), completion]);
        if (signal.aborted || finished) throw new NarrationError("CANCELLED");
        if (context.state !== "running") throw new NarrationError("AUTOPLAY_BLOCKED");
        source.start();
        onPlaying();
        await completion;
      } catch (error) {
        if (error instanceof NarrationError) throw error;
        throw new NarrationError(
          error instanceof Error && error.name === "NotAllowedError"
            ? "AUTOPLAY_BLOCKED"
            : "PLAYBACK_FAILED",
        );
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (source) source.onended = null;
        // If disconnect fails, retain ownership so a later stop can retry silence.
        await owned.stop();
      }
    },
  };
}
