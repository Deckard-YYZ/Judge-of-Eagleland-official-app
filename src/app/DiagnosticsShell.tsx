import type { MessageKey } from "../ui/i18n";
import {
  debugPreviewUrl,
  readModulePreview,
  modulePreviewIds,
  readInstructionVariant,
  instructionPreviewUrl,
  readNewsVariant,
  newsPreviewUrl,
  attributePreviewUrl,
  attributeMarkerPreviewUrl,
  readChatVariant,
  chatPreviewUrl,
} from "./debugPreviewRoutes";
import { useState, type ReactNode } from "react";
import { diagnosticViewer } from "../platform/diagnosticViewer";
import { useDocumentTranslator } from "../ui/i18n/useDocumentTranslator";
import { DiagnosticsPanel } from "../ui/DiagnosticsPanel";
import { DiagnosticErrorBoundary } from "./DiagnosticErrorBoundary";

/** Outside startup/render failure boundaries so evidence remains accessible. */
export function DiagnosticsShell({ children }: { children: ReactNode }) {
  const t = useDocumentTranslator();
  const moduleLabels = {
    instructions: "diagnostics.instructionsPreview",
    attributes: "diagnostics.attributesPreview",
    tutorial: "diagnostics.tutorialPreview",
    story: "diagnostics.storyPreview",
    action: "diagnostics.actionPreview",
    news: "diagnostics.newsPreview",
    "chat-single": "diagnostics.chatSinglePreview",
    "chat-multiple": "diagnostics.chatMultiplePreview",
    "chat-ignored": "diagnostics.chatIgnoredPreview",
    dispatch: "diagnostics.dispatchPreview",
  } as const satisfies Record<(typeof modulePreviewIds)[number], MessageKey>;
  const [open, setOpen] = useState(false);
  return (
    <>
      <DiagnosticErrorBoundary onDiagnostics={() => setOpen(true)}>
        {children}
      </DiagnosticErrorBoundary>
      <button type="button" className="diagnostics-launcher" onClick={() => setOpen(true)}>
        {t("diagnostics.open")}
      </button>
      {open && (
        <DiagnosticsPanel
          service={diagnosticViewer}
          onClose={() => setOpen(false)}
          modulePreview={
            import.meta.env.DEV
              ? {
                  active:
                    readChatVariant(window.location.search, true) ??
                    readNewsVariant(window.location.search, true) ??
                    readInstructionVariant(window.location.search, true) ??
                    readModulePreview(window.location.search, true),
                  entries: [
                    {
                      id: "dot",
                      label: "diagnostics.attributeDotPreview",
                      open: () =>
                        window.location.assign(
                          attributeMarkerPreviewUrl(window.location.href, "dot"),
                        ),
                    },
                    {
                      id: "square",
                      label: "diagnostics.attributeSquarePreview",
                      open: () =>
                        window.location.assign(
                          attributeMarkerPreviewUrl(window.location.href, "square"),
                        ),
                    },
                    {
                      id: "bar",
                      label: "diagnostics.attributeBarPreview",
                      open: () =>
                        window.location.assign(
                          attributeMarkerPreviewUrl(window.location.href, "bar"),
                        ),
                    },
                    {
                      id: "point",
                      label: "diagnostics.attributePointPreview",
                      open: () => window.location.assign(attributePreviewUrl(window.location.href)),
                    },
                    {
                      id: "contour",
                      label: "diagnostics.attributeContourPreview",
                      open: () =>
                        window.location.assign(
                          attributePreviewUrl(window.location.href, "contour"),
                        ),
                    },
                    {
                      id: "fill",
                      label: "diagnostics.attributeFillPreview",
                      open: () =>
                        window.location.assign(attributePreviewUrl(window.location.href, "fill")),
                    },
                    {
                      id: "hybrid",
                      label: "diagnostics.chatHybridPreview",
                      open: () =>
                        window.location.assign(chatPreviewUrl(window.location.href, "hybrid")),
                    },
                    {
                      id: "fragments",
                      label: "diagnostics.chatFragmentsPreview",
                      open: () =>
                        window.location.assign(chatPreviewUrl(window.location.href, "fragments")),
                    },
                    {
                      id: "takeover",
                      label: "diagnostics.chatTakeoverPreview",
                      open: () =>
                        window.location.assign(chatPreviewUrl(window.location.href, "takeover")),
                    },
                    {
                      id: "terminal",
                      label: "diagnostics.chatTerminalPreview",
                      open: () => window.location.assign(chatPreviewUrl(window.location.href)),
                    },
                    ...modulePreviewIds.map((id) => ({
                      id,
                      label: moduleLabels[id],
                      open: () => window.location.assign(debugPreviewUrl(window.location.href, id)),
                    })),
                    {
                      id: "bracket",
                      label: "diagnostics.instructionBracketPreview",
                      open: () =>
                        window.location.assign(instructionPreviewUrl(window.location.href)),
                    },
                    {
                      id: "advice",
                      label: "diagnostics.instructionAdvicePreview",
                      open: () =>
                        window.location.assign(
                          instructionPreviewUrl(window.location.href, "advice"),
                        ),
                    },
                    {
                      id: "memo",
                      label: "diagnostics.instructionMemoPreview",
                      open: () =>
                        window.location.assign(instructionPreviewUrl(window.location.href, "memo")),
                    },
                    {
                      id: "receipt",
                      label: "diagnostics.newsReceiptPreview",
                      open: () => window.location.assign(newsPreviewUrl(window.location.href)),
                    },
                    {
                      id: "postscript",
                      label: "diagnostics.newsPostscriptPreview",
                      open: () =>
                        window.location.assign(newsPreviewUrl(window.location.href, "postscript")),
                    },
                    {
                      id: "signature",
                      label: "diagnostics.newsSignaturePreview",
                      open: () =>
                        window.location.assign(newsPreviewUrl(window.location.href, "signature")),
                    },
                  ],
                  exit: () =>
                    window.location.assign(debugPreviewUrl(window.location.href, "default")),
                }
              : undefined
          }
          mainFlowPreview={
            import.meta.env.DEV
              ? {
                  active:
                    new URLSearchParams(window.location.search).get("mainFlowPreview") === "1",
                  toggle: () => {
                    const active =
                      new URLSearchParams(window.location.search).get("mainFlowPreview") === "1";
                    window.location.assign(
                      debugPreviewUrl(window.location.href, active ? "default" : "main-flow"),
                    );
                  },
                }
              : undefined
          }
        />
      )}
    </>
  );
}
