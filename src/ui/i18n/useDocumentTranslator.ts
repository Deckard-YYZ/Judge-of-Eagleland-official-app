import { useSyncExternalStore } from "react";
import { DEFAULT_LOCALE, parseAppLocale } from "./locale";
import { createTranslator } from "./translator";

// Diagnostics lives outside App's failure boundary and provider. Follow the
// same document language boundary so it remains usable even if App fails.
const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  return () => observer.disconnect();
};
const getLocale = () => parseAppLocale(document.documentElement.lang) ?? DEFAULT_LOCALE;
export function useDocumentTranslator() {
  const locale = useSyncExternalStore(subscribe, getLocale, () => DEFAULT_LOCALE);
  return createTranslator(locale);
}
