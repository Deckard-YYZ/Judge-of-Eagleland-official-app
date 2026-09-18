import { afterEach, expect, it, vi } from "vitest";
import { createWebAudioNarrationPlayer } from "../../src/platform/narrationPlayer";
class Context {
  static latest: Context;
  state = "running";
  destination = {};
  source = {
    buffer: null,
    onended: null as null | (() => void),
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  constructor() {
    Context.latest = this;
  }
  createBuffer() {
    return { copyToChannel: vi.fn() };
  }
  createBufferSource() {
    return this.source;
  }
  resume = vi.fn(async (): Promise<void> => undefined);
  close = vi.fn(async () => undefined);
}
const audio = { samples: new Float32Array(160), sampleRate: 16000 };
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("starts once, waits for ended, and disconnects before resolving", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = createWebAudioNarrationPlayer();
  const playing = vi.fn();
  let done = false;
  const pending = player.play(audio, new AbortController().signal, playing).then(() => {
    done = true;
  });
  await flush();
  expect(playing).toHaveBeenCalledOnce();
  expect(done).toBe(false);
  Context.latest.source.onended!();
  await pending;
  expect(Context.latest.source.disconnect).toHaveBeenCalled();
});
it("stop synchronously disconnects output and cancels playback", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = createWebAudioNarrationPlayer();
  const pending = player.play(audio, new AbortController().signal, () => {});
  const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  await flush();
  await player.stop();
  expect(Context.latest.source.disconnect).toHaveBeenCalled();
  await rejected;
});
it("suspended output is not mistaken for playback authorization", async () => {
  class Suspended extends Context {
    state = "suspended";
  }
  vi.stubGlobal("AudioContext", Suspended);
  const player = createWebAudioNarrationPlayer();
  await expect(player.play(audio, new AbortController().signal, () => {})).rejects.toMatchObject({
    code: "AUTOPLAY_BLOCKED",
  });
  expect(Context.latest.source.start).not.toHaveBeenCalled();
});
it("abort during pending resume never starts a late source", async () => {
  let resume!: () => void;
  class Delayed extends Context {
    resume = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resume = resolve;
        }),
    );
  }
  vi.stubGlobal("AudioContext", Delayed);
  const player = createWebAudioNarrationPlayer();
  const cancel = new AbortController();
  const pending = player.play(audio, cancel.signal, () => {});
  const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  cancel.abort();
  await rejected;
  resume();
  await flush();
  expect(Context.latest.source.start).not.toHaveBeenCalled();
});
it("failed disconnect keeps ownership, and retry releases the context and player", async () => {
  vi.stubGlobal("AudioContext", Context);
  const player = createWebAudioNarrationPlayer();
  const cancel = new AbortController();
  const pending = player.play(audio, cancel.signal, () => {});
  const failed = expect(pending).rejects.toMatchObject({ code: "PLAYBACK_FAILED" });
  await flush();
  const context = Context.latest;
  context.source.disconnect.mockImplementation(() => {
    throw Error("device");
  });
  cancel.abort();
  await failed;
  await expect(player.stop()).rejects.toMatchObject({ code: "PLAYBACK_FAILED" });
  expect(context.close).not.toHaveBeenCalled();
  context.source.disconnect.mockImplementation(() => {});
  await player.stop();
  expect(context.close).toHaveBeenCalledOnce();
  const next = player.play(audio, new AbortController().signal, () => {});
  await flush();
  Context.latest.source.onended!();
  await next;
});
it("maps context construction failure to playback failure", async () => {
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        throw Error("device");
      }
    },
  );
  await expect(
    createWebAudioNarrationPlayer().play(audio, new AbortController().signal, () => {}),
  ).rejects.toMatchObject({ code: "PLAYBACK_FAILED" });
});
