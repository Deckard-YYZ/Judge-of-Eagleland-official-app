import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/platform/voiceCapture.worklet.js", import.meta.url),
  "utf8",
);
function processor(sampleRate = 16000) {
  const messages: { type: string; samples?: Float32Array }[] = [];
  class Base {
    port = {
      onmessage: null as ((event: { data: string }) => void) | null,
      postMessage(message: { type: string; samples?: Float32Array }) {
        messages.push(message);
      },
    };
  }
  let Constructor!: new () => Base & { process(inputs: Float32Array[][]): boolean };
  runInNewContext(source, {
    AudioWorkletProcessor: Base,
    sampleRate,
    Float32Array,
    registerProcessor: (_name: string, value: typeof Constructor) => {
      Constructor = value;
    },
  });
  return { instance: new Constructor(), messages };
}
describe("actual voice worklet source", () => {
  it("mixes channels to finite mono without retaining samples", () => {
    const { instance, messages } = processor();
    instance.process([[new Float32Array([1, 0.5, NaN]), new Float32Array([-1, 0.5, 0])]]);
    expect(Array.from(messages[0].samples!)).toEqual([0, 0.5, 0]);
    instance.port.onmessage?.({ data: "stop" });
    expect(messages.at(-1)?.type).toBe("done");
    expect(instance.process([[new Float32Array(128)]])).toBe(false);
  });
  it("caps eight seconds even if the main-thread timer is delayed", () => {
    const { instance, messages } = processor(48000);
    const quantum = [new Float32Array(128)];
    for (let i = 0; i < 3100; i++) instance.process([quantum]);
    expect(messages.reduce((sum, message) => sum + (message.samples?.length ?? 0), 0)).toBe(384000);
    expect(messages.filter((message) => message.type === "done")).toHaveLength(1);
  });
});
