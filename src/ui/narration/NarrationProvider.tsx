import { createContext, useContext, useState, type ReactNode } from "react";
import type { NarrationService } from "../../shared/narration";

const unavailable: NarrationService = {
  available: false,
  speak: async () => ({ type: "failed", code: "UNAVAILABLE" }),
  stop: async () => {},
};
export const NARRATION_PREFERENCE_KEY = "judge-of-eagleland.narration-enabled";
const Context = createContext({
  service: unavailable,
  enabled: true,
  setEnabled: (_enabled: boolean) => {},
});

/** Device capability and local presentation preference never enter a game save. */
export function NarrationProvider({
  service = unavailable,
  children,
}: {
  service?: NarrationService;
  children: ReactNode;
}) {
  const [enabled, updateEnabled] = useState(() => {
    try {
      return localStorage.getItem(NARRATION_PREFERENCE_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const setEnabled = (value: boolean) => {
    updateEnabled(value);
    try {
      localStorage.setItem(NARRATION_PREFERENCE_KEY, String(value));
    } catch {
      /* Storage is optional; this session still honors the choice. */
    }
  };
  return <Context.Provider value={{ service, enabled, setEnabled }}>{children}</Context.Provider>;
}
export const useNarration = () => useContext(Context);
