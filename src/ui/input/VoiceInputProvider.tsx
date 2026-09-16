import { createContext, useContext, type ReactNode } from "react";
import { VoiceInputError, type VoiceInputService } from "../../shared/voiceInput";

const unavailableVoiceInput: VoiceInputService = {
  available: false,
  recognize: async () => {
    throw new VoiceInputError("UNAVAILABLE");
  },
};
const VoiceInputContext = createContext<VoiceInputService>(unavailableVoiceInput);

/** The app composition root supplies hardware; presentation knows only this contract. */
export function VoiceInputProvider({
  service,
  children,
}: {
  service?: VoiceInputService;
  children: ReactNode;
}) {
  return (
    <VoiceInputContext.Provider value={service ?? unavailableVoiceInput}>
      {children}
    </VoiceInputContext.Provider>
  );
}

export const useVoiceInput = (): VoiceInputService => useContext(VoiceInputContext);
