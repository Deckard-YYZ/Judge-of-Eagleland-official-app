import type { AppLocale } from "./locale";
import type { DiagnosticContext } from "./diagnostics";

export type NarrationVoiceId = "system";
export type NarrationPhase = "preparing" | "playing";
export type NarrationErrorCode =
  | "UNAVAILABLE"
  | "BUSY"
  | "INVALID_REQUEST"
  | "SYNTHESIS_FAILED"
  | "PLAYBACK_FAILED"
  | "AUTOPLAY_BLOCKED"
  | "TIMEOUT";
export class NarrationError extends Error {
  constructor(readonly code: NarrationErrorCode | "CANCELLED") {
    super(`Narration: ${code}`);
    this.name = "NarrationError";
  }
}
export type NarrationOutcome =
  | Readonly<{ type: "ended" }>
  | Readonly<{ type: "cancelled" }>
  | Readonly<{ type: "failed"; code: NarrationErrorCode }>;
export interface NarrationRequest {
  readonly requestId: string;
  readonly text: string;
  readonly locale: AppLocale;
  readonly voiceId: NarrationVoiceId;
  readonly signal: AbortSignal;
  readonly onPhase?: (phase: NarrationPhase) => void;
  readonly context?: DiagnosticContext;
}
export interface NarrationService {
  readonly available: boolean;
  speak(request: NarrationRequest): Promise<NarrationOutcome>;
  /** Resolves only after this request has no audible output; native work may still drain. */
  stop(requestId: string): Promise<void>;
}
export interface SynthesizedSpeech {
  readonly samples: Float32Array;
  readonly sampleRate: number;
}
export interface NarrationBackend {
  readonly available: boolean;
  /** Must settle only when the underlying native task has actually exited. */
  synthesize(request: NarrationRequest): Promise<SynthesizedSpeech>;
}
export interface NarrationPlayer {
  readonly available: boolean;
  play(audio: SynthesizedSpeech, signal: AbortSignal, onPlaying: () => void): Promise<void>;
  stop(): Promise<void>;
}
export const NARRATION_MAX_CHARACTERS = 500;
export const NARRATION_TIMEOUT_MS = 60000;
