import { getDiagnostics } from "../../shared/diagnostics";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ContentNarrationView } from "../../application/gameContentView";
import type { NarrationErrorCode, NarrationPhase } from "../../shared/narration";
import { useI18n, type MessageKey } from "../i18n";
import { useNarration } from "./NarrationProvider";

const errorKeys = {
  UNAVAILABLE: "narration.error.unavailable",
  BUSY: "narration.error.busy",
  INVALID_REQUEST: "narration.error.invalid",
  SYNTHESIS_FAILED: "narration.error.failed",
  PLAYBACK_FAILED: "narration.error.failed",
  AUTOPLAY_BLOCKED: "narration.error.autoplay",
  TIMEOUT: "narration.error.timeout",
} as const satisfies Record<NarrationErrorCode, MessageKey>;
let nextRequest = 0;

/** Mounted once per session/content/story/step entry, never per save revision or locale. */
export function NarrationControls({
  narration,
  ready,
  storyId,
  stepId,
}: {
  narration?: ContentNarrationView;
  ready: boolean;
  storyId: string;
  stepId: string;
}) {
  const { service, enabled } = useNarration();
  const { locale, t } = useI18n();
  const [phase, setPhase] = useState<NarrationPhase | "idle">("idle");
  const [error, setError] = useState<NarrationErrorCode | null>(null);
  const active = useRef<{ id: string; controller: AbortController } | null>(null);
  const autoConsumed = useRef(false);
  const mounted = useRef(false);
  const operation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const entryLocale = useRef(locale);
  const previousNarration = useRef(narration);
  const pendingLocaleProjection = useRef<{ previous?: ContentNarrationView } | null>(null);
  // Capturing a language change during render suppresses the old projection before effects run.
  if (entryLocale.current !== locale) {
    autoConsumed.current = true;
    entryLocale.current = locale;
    pendingLocaleProjection.current = { previous: previousNarration.current };
  }
  if (
    ready &&
    pendingLocaleProjection.current &&
    pendingLocaleProjection.current.previous !== narration
  )
    pendingLocaleProjection.current = null;
  previousNarration.current = narration;
  const projectionReady = ready && pendingLocaleProjection.current === null;
  const stop = useCallback(() => {
    const stoppingOperation = ++operation.current;
    const request = active.current;
    active.current = null;
    if (request) {
      request.controller.abort();
      void service.stop(request.id).catch(() => {
        if (mounted.current && operation.current === stoppingOperation) setError("PLAYBACK_FAILED");
        getDiagnostics().record({
          source: "narration",
          event: "narration.stop_failed",
          level: "warn",
          data: { requestId: request.id, storyId, stepId, code: "PLAYBACK_FAILED" },
        });
      });
    }
    setPhase("idle");
  }, [service, storyId, stepId]);
  const speak = useCallback(async () => {
    if (!enabled || !projectionReady || !narration || active.current) return;
    if (!service.available) {
      setError("UNAVAILABLE");
      return;
    }
    const context = { operationId: getDiagnostics().operationId() };
    const request = { id: `story-narration-${++nextRequest}`, controller: new AbortController() };
    getDiagnostics().record({
      source: "narration",
      event: "narration.entry",
      ...context,
      data: { requestId: request.id, storyId, stepId },
    });
    operation.current += 1;
    active.current = request;
    setError(null);
    setPhase("preparing");
    try {
      const result = await service.speak({
        ...narration,
        context,
        requestId: request.id,
        signal: request.controller.signal,
        onPhase: (value) => {
          if (active.current === request) setPhase(value);
        },
      });
      if (active.current !== request) return;
      if (result.type === "failed") setError(result.code);
    } catch {
      if (active.current === request) setError("SYNTHESIS_FAILED");
    } finally {
      if (active.current === request) {
        active.current = null;
        setPhase("idle");
      }
    }
  }, [enabled, projectionReady, narration, service, storyId, stepId]);

  useEffect(() => {
    // Cleanup invalidates only our request. Saving/feedback changes are deliberately absent.
    return stop;
  }, [stop, enabled, locale, ready]);
  useEffect(() => {
    let disposed = false;
    // StrictMode's probe cleanup must not consume the one automatic entry attempt.
    queueMicrotask(() => {
      if (disposed || autoConsumed.current || !enabled || !projectionReady || !narration) return;
      autoConsumed.current = true;
      void speak();
    });
    return () => {
      disposed = true;
    };
  }, [enabled, ready, narration, speak]);

  if (!narration || !enabled) return null;
  return (
    <div className="story-narration" aria-label={t("narration.label")}>
      {phase === "idle" ? (
        <button
          type="button"
          className="story-button story-button--secondary"
          disabled={!projectionReady}
          onClick={() => void speak()}
        >
          {t("narration.replay")}
        </button>
      ) : (
        <button type="button" className="story-button story-button--secondary" onClick={stop}>
          {t("narration.stop")}
        </button>
      )}
      {phase !== "idle" && (
        <span role="status">
          {t(phase === "preparing" ? "narration.preparing" : "narration.playing")}
        </span>
      )}
      {error && <p role="status">{t(errorKeys[error])}</p>}
    </div>
  );
}
