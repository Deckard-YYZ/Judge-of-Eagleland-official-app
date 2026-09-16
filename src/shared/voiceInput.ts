import type { AppLocale } from "./locale";
import type { DiagnosticContext } from "./diagnostics";
import type { RecognizedAction } from "./recognizedAction";

export type VoiceInputPhase = "requesting" | "recording" | "recognizing";
export type VoiceInputErrorCode =
  | "UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "PERMISSION_TIMEOUT"
  | "DEVICE_UNAVAILABLE"
  | "CAPTURE_FAILED"
  | "RECOGNITION_FAILED"
  | "RECOGNITION_TIMEOUT"
  | "BUSY"
  | "CANCELLED";

export class VoiceInputError extends Error {
  constructor(
    readonly code: VoiceInputErrorCode,
    options?: ErrorOptions,
  ) {
    super(`Voice input: ${code}`, options);
    this.name = "VoiceInputError";
  }
}

export interface VoiceInputRequest {
  readonly locale: AppLocale;
  /** Cancel the whole attempt; late media permission/results must be discarded. */
  readonly signal: AbortSignal;
  /** Finish recording early, then recognize the captured audio exactly once. */
  readonly stopSignal: AbortSignal;
  readonly onPhase: (phase: VoiceInputPhase) => void;
  readonly context?: DiagnosticContext;
}
export interface VoiceInputService {
  readonly available: boolean;
  recognize(request: VoiceInputRequest): Promise<RecognizedAction>;
}

/** PCM boundary: mono float32 at 16 kHz, finite [-1,1], at most eight seconds. */
export interface VoiceInferenceRequest {
  readonly samples: Float32Array;
  readonly sampleRate: 16000;
  readonly locale: AppLocale;
  readonly signal: AbortSignal;
  readonly context?: DiagnosticContext;
}
export interface VoiceInferenceBackend {
  readonly available: boolean;
  infer(request: VoiceInferenceRequest): Promise<RecognizedAction>;
}

export const VOICE_MAX_RECORDING_MS = 8000;
export const VOICE_SAMPLE_RATE = 16000;
