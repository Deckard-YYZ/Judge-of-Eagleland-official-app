import { describe, expect, it } from "vitest";
import { attributeMarkerPreviewUrl, readAttributeMarker } from "../../src/app/debugPreviewRoutes";
import {
  debugPreviewUrl,
  readAttributeVariant,
  attributePreviewUrl,
  readChatVariant,
  chatPreviewUrl,
  newsPreviewUrl,
  readNewsVariant,
  readInstructionVariant,
  instructionPreviewUrl,
  modulePreviewIds,
  readModulePreview,
} from "../../src/app/debugPreviewRoutes";

describe("debug preview routes", () => {
  it("clears conflicting previews while retaining unrelated query and fragment", () => {
    const href =
      "http://localhost:1420/?mainFlowPreview=1&configurationPilot=1&themeLab=1&uiPreview=A&keep=yes#case";
    const module = new URL(debugPreviewUrl(href, "instructions"));
    expect([...module.searchParams]).toEqual([
      ["keep", "yes"],
      ["modulePreview", "instructions"],
    ]);
    expect(module.hash).toBe("#case");
    const normal = new URL(debugPreviewUrl(module.href, "default"));
    expect(normal.search).toBe("?keep=yes");
    const flow = new URL(debugPreviewUrl(module.href, "main-flow"));
    expect(flow.searchParams.get("mainFlowPreview")).toBe("1");
    expect(flow.searchParams.has("modulePreview")).toBe(false);
  });
  it("accepts only available development modules", () => {
    for (const id of modulePreviewIds) {
      const url = new URL(debugPreviewUrl("http://localhost:1420/?mainFlowPreview=1", id));
      expect(readModulePreview(url.search, true)).toBe(id);
      expect(readModulePreview(url.search, false)).toBeNull();
      expect(url.searchParams.has("mainFlowPreview")).toBe(false);
    }
    expect(readModulePreview("?modulePreview=missing", true)).toBeNull();
  });
});

it("gates instruction variants to the DEV instruction scenario and clears them on navigation", () => {
  const url = new URL(instructionPreviewUrl("http://localhost:1420/?keep=yes"));
  expect(readInstructionVariant(url.search, true)).toBe("bracket");
  expect(readInstructionVariant(url.search, false)).toBeUndefined();
  expect(
    readInstructionVariant("?modulePreview=action&instructionVariant=bracket", true),
  ).toBeUndefined();
  expect(
    readInstructionVariant("?modulePreview=instructions&instructionVariant=unknown", true),
  ).toBeUndefined();
  expect(readInstructionVariant("?modulePreview=instructions", true)).toBeUndefined();
  expect(new URL(debugPreviewUrl(url.href, "default")).search).toBe("?keep=yes");
  expect(new URL(debugPreviewUrl(url.href, "news")).searchParams.has("instructionVariant")).toBe(
    false,
  );
});

it("opens the advice variant through the same isolated instruction route", () => {
  const url = new URL(instructionPreviewUrl("http://localhost:1420/?modulePreview=news", "advice"));
  expect(readInstructionVariant(url.search, true)).toBe("advice");
  expect(readInstructionVariant(url.search, false)).toBeUndefined();
});

it("opens the memorandum only in the DEV instruction scenario", () => {
  const url = new URL(instructionPreviewUrl("http://localhost:1420/?modulePreview=news", "memo"));
  expect(readInstructionVariant(url.search, true)).toBe("memo");
  expect(readInstructionVariant(url.search, false)).toBeUndefined();
  expect(
    readInstructionVariant("?modulePreview=news&instructionVariant=memo", true),
  ).toBeUndefined();
});

it("gates the receipt preview to DEV news and clears it on module navigation", () => {
  const url = new URL(newsPreviewUrl("http://localhost:1420/?instructionVariant=bracket&keep=1"));
  expect(readNewsVariant(url.search, true)).toBe("receipt");
  expect(readNewsVariant(url.search, false)).toBeUndefined();
  expect(readNewsVariant("?modulePreview=action&newsVariant=receipt", true)).toBeUndefined();
  expect(url.searchParams.has("instructionVariant")).toBe(false);
  expect(new URL(debugPreviewUrl(url.href, "default")).search).toBe("?keep=1");
});

it("routes the postscript preview through the DEV news scenario", () => {
  const url = new URL(newsPreviewUrl("http://localhost:1420/", "postscript"));
  expect(readNewsVariant(url.search, true)).toBe("postscript");
  expect(readNewsVariant(url.search, false)).toBeUndefined();
  expect(readNewsVariant("?modulePreview=action&newsVariant=postscript", true)).toBeUndefined();
});

it("routes the signature preview only through DEV news", () => {
  const url = new URL(newsPreviewUrl("http://localhost:1420/", "signature"));
  expect(readNewsVariant(url.search, true)).toBe("signature");
  expect(readNewsVariant(url.search, false)).toBeUndefined();
  expect(readNewsVariant("?modulePreview=action&newsVariant=signature", true)).toBeUndefined();
});

it("gates terminal chat variants and clears them on navigation", () => {
  const url = new URL(chatPreviewUrl("http://localhost:1420/?newsVariant=signature&keep=yes"));
  expect(readChatVariant(url.search, true)).toBe("terminal");
  expect(readChatVariant(url.search, false)).toBeUndefined();
  expect(readChatVariant("?modulePreview=news&chatVariant=terminal", true)).toBeUndefined();
  expect(readChatVariant("?modulePreview=chat-single&chatVariant=unknown", true)).toBeUndefined();
  expect(url.searchParams.has("newsVariant")).toBe(false);
  expect(new URL(debugPreviewUrl(url.href, "default")).search).toBe("?keep=yes");
});

it("opens the takeover comparison with the same isolated chat scenario", () => {
  const url = new URL(chatPreviewUrl("http://localhost:1420/?chatVariant=terminal", "takeover"));
  expect(readChatVariant(url.search, true)).toBe("takeover");
  expect(readChatVariant(url.search, false)).toBeUndefined();
});

it("opens fragments only in development chat scenarios", () => {
  const url = new URL(chatPreviewUrl("http://localhost:1420/", "fragments"));
  expect(readChatVariant(url.search, true)).toBe("fragments");
  expect(readChatVariant(url.search, false)).toBeUndefined();
  expect(readChatVariant("?modulePreview=chat-multiple&chatVariant=fragments", true)).toBe(
    "fragments",
  );
});

it("gates the hybrid comparison and clears it when leaving chats", () => {
  const url = new URL(chatPreviewUrl("http://localhost:1420/", "hybrid"));
  expect(readChatVariant(url.search, true)).toBe("hybrid");
  expect(readChatVariant(url.search, false)).toBeUndefined();
  expect(readChatVariant("?modulePreview=news&chatVariant=hybrid", true)).toBeUndefined();
  expect(new URL(debugPreviewUrl(url.href, "action")).searchParams.has("chatVariant")).toBe(false);
});

it("gates attribute point previews to their dedicated DEV module", () => {
  const url = new URL(attributePreviewUrl("http://localhost:1420/?chatVariant=hybrid"));
  expect(readAttributeVariant(url.search, true)).toBe("point");
  expect(readAttributeVariant(url.search, false)).toBeUndefined();
  expect(readAttributeVariant("?modulePreview=news&attributeVariant=point", true)).toBeUndefined();
  expect(new URL(debugPreviewUrl(url.href, "default")).searchParams.has("attributeVariant")).toBe(
    false,
  );
});

it("routes the contour comparison through the same attribute demo", () => {
  const url = new URL(attributePreviewUrl("http://localhost:1420/", "contour"));
  expect(readAttributeVariant(url.search, true)).toBe("contour");
  expect(readAttributeVariant(url.search, false)).toBeUndefined();
});

it("routes fill only to the DEV attributes module", () => {
  const url = new URL(attributePreviewUrl("http://localhost:1420/", "fill"));
  expect(readAttributeVariant(url.search, true)).toBe("fill");
  expect(readAttributeVariant(url.search, false)).toBeUndefined();
  expect(readAttributeVariant("?modulePreview=news&attributeVariant=fill", true)).toBeUndefined();
});

it.each(["dot", "square", "bar"] as const)("gates %s marker to point previews", (marker) => {
  const url = new URL(attributeMarkerPreviewUrl("http://localhost:1420/", marker));
  expect(readAttributeMarker(url.search, true)).toBe(marker);
  expect(readAttributeMarker(url.search, false)).toBeUndefined();
  expect(
    readAttributeMarker("?modulePreview=news&attributeMarker=" + marker, true),
  ).toBeUndefined();
  expect(
    readAttributeMarker(
      "?modulePreview=attributes&attributeVariant=contour&attributeMarker=" + marker,
      true,
    ),
  ).toBeUndefined();
  expect(new URL(debugPreviewUrl(url.href, "default")).searchParams.has("attributeMarker")).toBe(
    false,
  );
});
