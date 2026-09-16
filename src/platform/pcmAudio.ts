import { VOICE_MAX_RECORDING_MS, VOICE_SAMPLE_RATE } from "../shared/voiceInput";

/** Windowed-sinc low-pass resampling; timestamps use the actual capture rate. */
export function resampleVoicePcm(input: Float32Array, sampleRate: number): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new RangeError("Unsupported capture sample rate");
  }
  const frames = Math.min(input.length, Math.floor((sampleRate * VOICE_MAX_RECORDING_MS) / 1000));
  const length = Math.min(128000, Math.floor((frames * VOICE_SAMPLE_RATE) / sampleRate));
  const result = new Float32Array(length);
  const ratio = sampleRate / VOICE_SAMPLE_RATE;
  const cutoff = Math.min(1, 1 / ratio) * 0.9;
  const radius = Math.ceil(16 / cutoff);
  for (let output = 0; output < length; output++) {
    const position = output * ratio;
    let value = 0;
    let weight = 0;
    for (
      let source = Math.max(0, Math.ceil(position - radius));
      source <= Math.min(frames - 1, Math.floor(position + radius));
      source++
    ) {
      const distance = source - position;
      const x = Math.PI * distance * cutoff;
      const coefficient =
        (x === 0 ? 1 : Math.sin(x) / x) * (0.5 + 0.5 * Math.cos((Math.PI * distance) / radius));
      const sample = input[source];
      value += (Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0) * coefficient;
      weight += coefficient;
    }
    result[output] = Math.max(-1, Math.min(1, weight === 0 ? 0 : value / weight));
  }
  return result;
}
