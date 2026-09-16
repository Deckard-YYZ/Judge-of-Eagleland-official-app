/* Runs in AudioWorkletGlobalScope. Never retain more than one render quantum. */
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.remaining = Math.floor(sampleRate * 8);
    this.finished = false;
    this.port.onmessage = ({ data }) => {
      if (data === "stop") this.finish();
    };
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.port.postMessage({ type: "done" });
  }

  process(inputs) {
    if (this.finished) return false;
    const channels = inputs[0];
    if (!channels?.length || !channels[0].length) return true;
    const length = Math.min(channels[0].length, this.remaining);
    const samples = new Float32Array(length);
    for (let frame = 0; frame < length; frame++) {
      let sum = 0;
      for (const channel of channels) sum += channel[frame] ?? 0;
      const sample = sum / channels.length;
      samples[frame] = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
    }
    this.port.postMessage({ type: "samples", samples }, [samples.buffer]);
    this.remaining -= length;
    if (this.remaining === 0) this.finish();
    // Output remains zero, so the capture graph cannot monitor the microphone.
    return !this.finished;
  }
}

registerProcessor("voice-capture", VoiceCaptureProcessor);
