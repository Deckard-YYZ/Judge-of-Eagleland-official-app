import type { ReactNode } from "react";
import { createVoiceInputService } from "../platform/voiceInput";
import { sherpaVoiceBackend } from "../platform/sherpaVoiceBackend";
import { VoiceInputProvider } from "../ui/input/VoiceInputProvider";
import { NarrationProvider } from "../ui/narration/NarrationProvider";
import { createAudioOccupancy } from "../platform/audioOccupancy";
import { createNarrationService } from "../platform/narration";
import { createWebAudioNarrationPlayer } from "../platform/narrationPlayer";
import { sherpaNarrationBackend } from "../platform/sherpaNarrationBackend";

// One capture/inference gate spans profile and story changes. Constructing the
// service never requests permission; only an explicit recording attempt does.
const occupancy = createAudioOccupancy();
const voiceInput = createVoiceInputService(sherpaVoiceBackend, occupancy);
const narration = createNarrationService(
  sherpaNarrationBackend,
  createWebAudioNarrationPlayer(),
  occupancy,
);

export function VoiceInputShell({ children }: { children: ReactNode }) {
  return (
    <VoiceInputProvider service={voiceInput}>
      <NarrationProvider service={narration}>{children}</NarrationProvider>
    </VoiceInputProvider>
  );
}
