/** Root-scoped reservation: input claims synchronously before awaiting output silence. */
export function createAudioOccupancy(tailMs = 150) {
  let input: object | null = null;
  let narration: { owner: object; stop: () => Promise<void> } | null = null;
  return {
    reserveNarration(owner: object, stop: () => Promise<void>): boolean {
      if (input || narration) return false;
      narration = { owner, stop };
      return true;
    },
    releaseNarration(owner: object) {
      if (narration?.owner === owner) narration = null;
    },
    reserveInput() {
      if (input) return null;
      const owner = {};
      input = owner;
      return {
        async prepare() {
          await narration?.stop();
          // Fixed, bounded tail protection is an implementation guard, not a game timer.
          await new Promise<void>((resolve) =>
            setTimeout(resolve, Math.max(0, Math.min(500, tailMs))),
          );
        },
        release() {
          if (input === owner) input = null;
        },
      };
    },
  };
}
export type AudioOccupancy = ReturnType<typeof createAudioOccupancy>;
