import { resampleVoicePcm } from "./pcmAudio";

// This module is built as a dedicated worker, not evaluated in the window.
declare const self: {
  onmessage: ((event: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => void) | null;
  postMessage(message: Float32Array, transfer: Transferable[]): void;
};

self.onmessage = ({ data }) => {
  const samples = resampleVoicePcm(data.samples, data.sampleRate);
  self.postMessage(samples, [samples.buffer]);
};
