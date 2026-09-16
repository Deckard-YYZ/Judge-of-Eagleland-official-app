import { describe, expect, it } from "vitest";
import { resampleVoicePcm } from "../../src/platform/pcmAudio";

describe("voice PCM resampling", () => {
  it.each([44100, 48000, 16000])("preserves one second and a 1kHz signal at %i Hz", (rate) => {
    const input = Float32Array.from(
      { length: rate },
      (_, index) => 0.5 * Math.sin((2 * Math.PI * 1000 * index) / rate),
    );
    const output = resampleVoicePcm(input, rate);
    expect(output.length).toBe(16000);
    let error = 0;
    for (let index = 100; index < 15900; index++)
      error += (output[index] - 0.5 * Math.sin((2 * Math.PI * 1000 * index) / 16000)) ** 2;
    expect(Math.sqrt(error / 15800)).toBeLessThan(0.002);
  });
  it("suppresses frequencies above the output Nyquist limit", () => {
    const input = Float32Array.from({ length: 48000 }, (_, index) =>
      Math.sin((2 * Math.PI * 12000 * index) / 48000),
    );
    const output = resampleVoicePcm(input, 48000).subarray(100, 15900);
    const energy = output.reduce((sum, sample) => sum + sample * sample, 0) / output.length;
    expect(Math.sqrt(energy)).toBeLessThan(0.01);
  });
  it("caps duration and sanitizes samples", () => {
    const input = new Float32Array(16000 * 9).fill(2);
    input[10] = NaN;
    input[11] = Infinity;
    const output = resampleVoicePcm(input, 16000);
    expect(output.length).toBe(128000);
    expect(output.every((sample) => Number.isFinite(sample) && sample >= -1 && sample <= 1)).toBe(
      true,
    );
    expect(() => resampleVoicePcm(input, NaN)).toThrow(RangeError);
  });
});
