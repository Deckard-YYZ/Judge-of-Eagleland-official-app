import { afterEach, expect, it, vi } from "vitest";
import { recordVoiceAudio, summarizeVoiceAudio } from "../../src/platform/voiceAudioStats";
import { configureDiagnostics } from "../../src/shared/diagnostics";
import { createDiagnosticTransport, type DiagnosticRecord } from "../../src/platform/diagnostics";
afterEach(() => configureDiagnostics(() => undefined));
it("summarizes synthetic silence, sine and clipping without interpreting speech", () => {
  expect(summarizeVoiceAudio(new Float32Array(16000), 16000)).toMatchObject({
    sampleCount: 16000,
    durationMs: 1000,
    rms: 0,
    peak: 0,
    rmsDbfs: -120,
    dbfsFloored: true,
    nearZeroRatio: 1,
    clippedRatio: 0,
  });
  const sine = Float32Array.from(
    { length: 16000 },
    (_, n) => 0.5 * Math.sin((2 * Math.PI * 1000 * n) / 16000),
  );
  expect(summarizeVoiceAudio(sine, 16000).rms).toBeCloseTo(0.5 / Math.sqrt(2), 6);
  const loudThenSilent = new Float32Array(16000);
  loudThenSilent.set(sine.subarray(0, 320));
  const summary = summarizeVoiceAudio(loudThenSilent, 16000);
  expect(summary.maxFrameRms).toBeGreaterThan(summary.rms * 5);
  expect(summarizeVoiceAudio(new Float32Array([1, -1, 0, 0]), 16000).clippedRatio).toBe(0.5);
  expect(summarizeVoiceAudio(new Float32Array([NaN, Infinity]), NaN)).toMatchObject({
    invalidSampleCount: 2,
    rms: 0,
    sampleRate: 0,
    durationMs: 0,
  });
});
it("retains scalar evidence through the actual transport while excluding raw audio/device details", async () => {
  const records: DiagnosticRecord[] = [];
  const transport = createDiagnosticTransport(
    { runId: "test", buildId: "test", development: false },
    async (batch) => {
      records.push(...batch);
    },
  );
  configureDiagnostics(transport.record);
  recordVoiceAudio("voice.pcm_resampled", new Float32Array([0, 0.5, -0.5]), 16000, {
    operationId: "op-test",
  });
  transport.record({
    source: "voiceInput",
    event: "voice.capture_settings",
    data: {
      sampleRate: 48000,
      audioContextSampleRate: 48000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
      deviceId: "private-device",
      label: "private-label",
      samples: [0.123456],
    },
  });
  await vi.waitFor(() => expect(records).toHaveLength(2));
  expect(records[0].data).toEqual(summarizeVoiceAudio(new Float32Array([0, 0.5, -0.5]), 16000));
  expect(records[1].data).toMatchObject({ channelCount: 1, autoGainControl: false });
  expect(JSON.stringify(records)).not.toMatch(/private-device|private-label|0\.123456/);
  configureDiagnostics(() => {
    throw new Error("sink failure");
  });
  expect(() => recordVoiceAudio("voice.pcm_captured", new Float32Array(), 16000)).not.toThrow();
});
