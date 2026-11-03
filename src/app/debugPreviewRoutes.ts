import type { AttributeVariant, AttributeMarker } from "../ui/shell/attributeVariant";
import type { ChatVariant } from "../ui/presentation/chat/chatVariant";
export const modulePreviewIds = [
  "instructions",
  "attributes",
  "tutorial",
  "story",
  "action",
  "news",
  "chat-single",
  "chat-multiple",
  "chat-ignored",
  "dispatch",
] as const;
export type ModulePreviewId = (typeof modulePreviewIds)[number];
export type DebugPreviewTarget = ModulePreviewId | "main-flow" | "default";
const previewKeys = [
  "modulePreview",
  "instructionVariant",
  "newsVariant",
  "chatVariant",
  "attributeVariant",
  "attributeMarker",
  "mainFlowPreview",
  "configurationPilot",
  "themeLab",
  "uiPreview",
];
/** Preview navigation reloads an isolated composition; unrelated query options survive. */
export function debugPreviewUrl(href: string, target: DebugPreviewTarget): string {
  const url = new URL(href);
  for (const key of previewKeys) url.searchParams.delete(key);
  if (target !== "main-flow" && target !== "default") url.searchParams.set("modulePreview", target);
  if (target === "main-flow") url.searchParams.set("mainFlowPreview", "1");
  return url.href;
}
export function readModulePreview(search: string, development: boolean): ModulePreviewId | null {
  if (!development) return null;
  const requested = new URLSearchParams(search).get("modulePreview");
  return modulePreviewIds.find((id) => id === requested) ?? null;
}

export function readInstructionVariant(
  search: string,
  development: boolean,
): "bracket" | "advice" | "memo" | undefined {
  if (readModulePreview(search, development) !== "instructions") return undefined;
  const variant = new URLSearchParams(search).get("instructionVariant");
  return variant === "bracket" || variant === "advice" || variant === "memo" ? variant : undefined;
}

export function instructionPreviewUrl(
  href: string,
  variant: "bracket" | "advice" | "memo" = "bracket",
): string {
  const url = new URL(debugPreviewUrl(href, "instructions"));
  url.searchParams.set("instructionVariant", variant);
  return url.href;
}

export function readNewsVariant(
  search: string,
  development: boolean,
): "receipt" | "postscript" | "signature" | undefined {
  if (readModulePreview(search, development) !== "news") return undefined;
  const variant = new URLSearchParams(search).get("newsVariant");
  return variant === "receipt" || variant === "postscript" || variant === "signature"
    ? variant
    : undefined;
}
export function newsPreviewUrl(
  href: string,
  variant: "receipt" | "postscript" | "signature" = "receipt",
): string {
  const url = new URL(debugPreviewUrl(href, "news"));
  url.searchParams.set("newsVariant", variant);
  return url.href;
}

export function readChatVariant(search: string, development: boolean): ChatVariant | undefined {
  const module = readModulePreview(search, development);
  if (module !== "chat-single" && module !== "chat-multiple" && module !== "chat-ignored")
    return undefined;
  const variant = new URLSearchParams(search).get("chatVariant");
  return variant === "terminal" ||
    variant === "takeover" ||
    variant === "fragments" ||
    variant === "hybrid"
    ? variant
    : undefined;
}
export function chatPreviewUrl(href: string, variant: ChatVariant = "terminal"): string {
  const url = new URL(debugPreviewUrl(href, "chat-single"));
  url.searchParams.set("chatVariant", variant);
  return url.href;
}

export function readAttributeVariant(
  search: string,
  development: boolean,
): AttributeVariant | undefined {
  if (readModulePreview(search, development) !== "attributes") return undefined;
  const variant = new URLSearchParams(search).get("attributeVariant");
  return variant === null
    ? "point"
    : variant === "point" || variant === "contour" || variant === "fill"
      ? variant
      : undefined;
}
export function attributePreviewUrl(href: string, variant: AttributeVariant = "point"): string {
  const url = new URL(debugPreviewUrl(href, "attributes"));
  url.searchParams.set("attributeVariant", variant);
  return url.href;
}

export function readAttributeMarker(
  search: string,
  development: boolean,
): AttributeMarker | undefined {
  if (
    readModulePreview(search, development) !== "attributes" ||
    readAttributeVariant(search, development) !== "point"
  )
    return undefined;
  const marker = new URLSearchParams(search).get("attributeMarker");
  return marker === "dot" || marker === "square" || marker === "bar" ? marker : undefined;
}
export function attributeMarkerPreviewUrl(href: string, marker: AttributeMarker): string {
  const url = new URL(attributePreviewUrl(href));
  url.searchParams.set("attributeMarker", marker);
  return url.href;
}
