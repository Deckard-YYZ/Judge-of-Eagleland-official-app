import type { AppLocale } from "./locale";
import { EN_US_MESSAGES } from "./messages/en-US";
import { DEFAULT_MESSAGES } from "./messages/zh-CN";

export type MessageKey = keyof typeof DEFAULT_MESSAGES;
export type MessageCatalog = Readonly<Record<MessageKey, string>>;
export type InterpolationValue = string | number;

type ExtractParameterNames<Message extends string> =
  Message extends `${string}{${infer Parameter}}${infer Rest}`
    ? Parameter | ExtractParameterNames<Rest>
    : never;

type TranslationArguments<Key extends MessageKey> = [
  ExtractParameterNames<(typeof DEFAULT_MESSAGES)[Key]>,
] extends [never]
  ? []
  : [
      parameters: Readonly<
        Record<ExtractParameterNames<(typeof DEFAULT_MESSAGES)[Key]>, InterpolationValue>
      >,
    ];

export type Translate = <Key extends MessageKey>(
  key: Key,
  ...arguments_: TranslationArguments<Key>
) => string;

export const MESSAGE_CATALOGS: Readonly<Record<AppLocale, MessageCatalog>> = {
  "zh-CN": DEFAULT_MESSAGES,
  "en-US": EN_US_MESSAGES,
};

export interface TranslatorOptions {
  catalogs?: Readonly<Partial<Record<AppLocale, Readonly<Partial<MessageCatalog>>>>>;
  missingTranslation?: "throw" | "fallback";
}

const interpolate = (
  key: MessageKey,
  template: string,
  parameters: Readonly<Record<string, InterpolationValue>> | undefined,
): string =>
  template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_token, parameter: string) => {
    if (!parameters || !Object.hasOwn(parameters, parameter)) {
      throw new Error(`[i18n] Missing parameter "${parameter}" for message "${key}".`);
    }

    return String(parameters[parameter]);
  });

export function createTranslator(locale: AppLocale, options: TranslatorOptions = {}): Translate {
  const catalog = options.catalogs?.[locale] ?? MESSAGE_CATALOGS[locale];
  const missingTranslation =
    options.missingTranslation ?? (import.meta.env.DEV ? "throw" : "fallback");

  return ((key: MessageKey, parameters?: Readonly<Record<string, InterpolationValue>>) => {
    let template = catalog[key];
    if (template === undefined) {
      if (missingTranslation === "throw") {
        throw new Error(`[i18n] Missing ${locale} translation for message "${key}".`);
      }
      template = DEFAULT_MESSAGES[key];
    }

    return interpolate(key, template, parameters);
  }) as Translate;
}
