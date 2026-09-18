import { getDiagnostics, type DiagnosticContext } from "../shared/diagnostics";
/** Signal-level evidence only. These thresholds do not detect speech or quality. */
export function summarizeVoiceAudio(samples: Float32Array, sampleRate: number) {
  sampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 0;
  const frameSize = Math.max(1, Math.round(sampleRate * 0.02));
  let frameSum = 0,
    frameCount = 0,
    maxFrameRms = 0;
  let sum = 0,
    peak = 0,
    nearZero = 0,
    clipped = 0,
    invalid = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) {
      invalid++;
      continue;
    }
    const amplitude = Math.abs(sample);
    sum += sample * sample;
    frameSum += sample * sample;
    frameCount++;
    if (frameCount === frameSize) {
      maxFrameRms = Math.max(maxFrameRms, Math.sqrt(frameSum / frameCount));
      frameCount = 0;
      frameSum = 0;
    }
    peak = Math.max(peak, amplitude);
    if (amplitude <= 0.0001) nearZero++;
    if (amplitude >= 0.999) clipped++;
  }
  if (frameCount) maxFrameRms = Math.max(maxFrameRms, Math.sqrt(frameSum / frameCount));
  const finiteCount = samples.length - invalid;
  const rms = finiteCount ? Math.sqrt(sum / finiteCount) : 0;
  return {
    sampleRate,
    sampleCount: samples.length,
    durationMs: sampleRate > 0 ? (samples.length / sampleRate) * 1000 : 0,
    rms,
    peak,
    maxFrameRms,
    frameDurationMs: 20,
    rmsDbfs: Math.max(-120, 20 * Math.log10(rms || 1e-6)),
    dbfsFloor: -120,
    dbfsFloored: rms <= 1e-6,
    nearZeroRatio: finiteCount ? nearZero / finiteCount : 0,
    nearZeroThreshold: 0.0001,
    clippedRatio: finiteCount ? clipped / finiteCount : 0,
    clippingThreshold: 0.999,
    invalidSampleCount: invalid,
  };
}

/** Observation cannot fail a successful capture, even if a host object is broken. */
export function recordVoiceAudio(
  event: string,
  samples: Float32Array,
  sampleRate: number,
  context?: DiagnosticContext,
): void {
  try {
    getDiagnostics().record({
      source: "voiceInput",
      event,
      ...context,
      data: summarizeVoiceAudio(samples, sampleRate),
    });
  } catch {
    /* Best-effort diagnostics; keep the original audio path unchanged. */
  }
}
