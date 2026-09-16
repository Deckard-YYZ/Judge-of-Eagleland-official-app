import type { ReactNode } from "react";
import { createVoiceInputService } from "../platform/voiceInput";
import { sherpaVoiceBackend } from "../platform/sherpaVoiceBackend";
import { VoiceInputProvider } from "../ui/input/VoiceInputProvider";

// One capture/inference gate spans profile and story changes. Constructing the
// service never requests permission; only an explicit recording attempt does.
const voiceInput = createVoiceInputService(sherpaVoiceBackend);

export function VoiceInputShell({ children }: { children: ReactNode }) {
  return <VoiceInputProvider service={voiceInput}>{children}</VoiceInputProvider>;
}
