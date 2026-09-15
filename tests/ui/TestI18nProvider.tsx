import type { PropsWithChildren } from "react";
import { I18nProvider } from "../../src/ui/i18n";

export function TestI18nProvider({ children }: PropsWithChildren) {
  return <I18nProvider storage={null}>{children}</I18nProvider>;
}
