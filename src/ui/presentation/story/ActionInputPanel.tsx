import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  ContentAttributeView,
  ContentStoryStepView,
} from "../../../application/gameContentView";
import type { GameSessionErrorCode } from "../../../application/gameSession";
import type { GameSessionView } from "../../../application/gameSessionView";
import { matchTextAction } from "../../../input/matchTextAction";
import { translateSessionError, useI18n } from "../../i18n";
import { StoryBlocks } from "./StoryBlocks";
import { getDiagnostics, type DiagnosticContext } from "../../../shared/diagnostics";
import type { RecognizedAction } from "../../../shared/recognizedAction";
import {
  VoiceInputError,
  type VoiceInputErrorCode,
  type VoiceInputPhase,
} from "../../../shared/voiceInput";
import { useVoiceInput } from "../../input/VoiceInputProvider";

interface ActionInputPanelProps {
  sessionView: GameSessionView;
  storyId: string;
  step: Extract<ContentStoryStepView, { type: "actionInput" }>;
  attributes: Readonly<Record<string, ContentAttributeView>>;
  busy: boolean;
}

type InputNotice =
  | { type: "unknown" }
  | { type: "voiceError"; code: VoiceInputErrorCode }
  | { type: "wrong"; changes: readonly { attributeId: string; actualDelta: number }[] }
  | { type: "error"; code: GameSessionErrorCode | "unexpected" };

/** Recognition is local; only saved Core results can advance the story or announce penalties. */
export function ActionInputPanel({
  sessionView,
  storyId,
  step,
  attributes,
  busy,
}: ActionInputPanelProps) {
  const { locale, t, formatNumber } = useI18n();
  const voice = useVoiceInput();
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [phase, setPhase] = useState<VoiceInputPhase | null>(null);
  const round = useRef<{
    cancel: AbortController;
    stop: AbortController;
    context: DiagnosticContext;
  } | null>(null);
  // Read the latest ownership even if a service settles before effect cleanup runs.
  const ownership = useRef({ sessionView, storyId, stepId: step.id, locale, mode, busy, voice });
  ownership.current = { sessionView, storyId, stepId: step.id, locale, mode, busy, voice };
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<InputNotice | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const inFlight = useRef(false);
  const operationVersion = useRef(0);
  const lastChangeLog = useRef(0);
  const cancelVoice = (updateUi = true): void => {
    const previous = round.current;
    round.current = null; // Invalidate first: abort listeners may synchronously report a result.
    previous?.cancel.abort();
    if (previous)
      getDiagnostics().record({
        source: "input",
        event: "voice.round_cancelled",
        ...previous.context,
      });
    if (updateUi) setPhase(null);
  };
  const inputDebug = (event: string, inputLength?: number): void =>
    getDiagnostics().record({
      source: "input",
      event,
      level: "debug",
      data: { storyId, stepId: step.id, inputLength },
    });

  useEffect(() => {
    inFlight.current = false;
    composing.current = false;
    setSubmitting(false);
    setPhase(null);
    setNotice(null);
    setText("");
    return () => {
      cancelVoice(false);
      operationVersion.current += 1;
    };
  }, [sessionView, storyId, step.id]);

  useEffect(() => {
    cancelVoice();
    setText("");
    // A language change starts the next recognition round; it never cancels a saved command.
  }, [locale]);

  useEffect(() => {
    if (busy) cancelVoice();
  }, [busy]);

  useEffect(() => {
    cancelVoice();
    return () => cancelVoice(false);
  }, [voice]);

  useEffect(() => {
    if (!busy && !submitting) inputRef.current?.focus();
  }, [busy, submitting, mode]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const context = { operationId: getDiagnostics().operationId() };
    getDiagnostics().record({
      source: "input",
      event: "input.submitted",
      ...context,
      data: { storyId, stepId: step.id, inputLength: text.length, locale },
    });
    if (
      busy ||
      mode !== "text" ||
      inFlight.current ||
      composing.current ||
      sessionView.getSnapshot().status !== "ready"
    ) {
      getDiagnostics().record({
        source: "input",
        event: "input.blocked",
        ...context,
        data: { storyId, stepId: step.id, reason: composing.current ? "composition" : "busy" },
      });
      return;
    }
    const recognized = matchTextAction(text, locale);
    await acceptRecognized(recognized, context);
  };

  const acceptRecognized = async (
    recognized: RecognizedAction,
    context: DiagnosticContext,
  ): Promise<void> => {
    if (inFlight.current || sessionView.getSnapshot().status !== "ready") return;
    getDiagnostics().record({
      source: "input",
      event: "input.recognized",
      ...context,
      data: {
        storyId,
        stepId: step.id,
        recognition: recognized.type,
        actionId: recognized.type === "known" ? recognized.actionId : undefined,
      },
    });
    if (recognized.type === "unknown") {
      setNotice({ type: "unknown" });
      return;
    }

    // Acquire synchronously before dispatch: React state alone cannot stop two events in one turn.
    inFlight.current = true;
    const version = ++operationVersion.current;
    setSubmitting(true);
    setNotice(null);
    try {
      const result = await sessionView.dispatch(
        {
          type: "submitStoryInput",
          storyId,
          stepId: step.id,
          actionId: recognized.actionId,
        },
        context,
      );
      if (operationVersion.current !== version) return;
      if (!result.ok) {
        setNotice({ type: "error", code: result.code });
      } else {
        const ownFeedback = result.feedback.filter(
          (feedback) =>
            feedback.source.type === "storyInput" &&
            feedback.source.storyId === storyId &&
            feedback.source.stepId === step.id,
        );
        if (ownFeedback.some((feedback) => feedback.type === "inputFeedback")) {
          setNotice({
            type: "wrong",
            changes: ownFeedback.flatMap((feedback) =>
              feedback.type === "attributeFeedback" ? feedback.changes : [],
            ),
          });
          setText("");
        }
        // Correct input is reflected by the published checkpoint, never a UI target comparison.
      }
    } catch (error) {
      getDiagnostics().record({
        source: "input",
        event: "input.dispatch_failed",
        level: "error",
        ...context,
        error,
      });
      if (operationVersion.current === version) setNotice({ type: "error", code: "unexpected" });
    } finally {
      if (operationVersion.current === version) {
        inFlight.current = false;
        setSubmitting(false);
      }
    }
  };

  const startVoice = async (): Promise<void> => {
    if (
      busy ||
      inFlight.current ||
      round.current ||
      !voice.available ||
      sessionView.getSnapshot().status !== "ready"
    )
      return;
    const context = { operationId: getDiagnostics().operationId() };
    const current = { cancel: new AbortController(), stop: new AbortController(), context };
    const owner = ownership.current;
    const save = sessionView.getSnapshot().envelope;
    round.current = current;
    const isCurrent = (): boolean => {
      const latest = ownership.current;
      const snapshot = sessionView.getSnapshot();
      return (
        round.current === current &&
        !current.cancel.signal.aborted &&
        latest.sessionView === owner.sessionView &&
        latest.storyId === owner.storyId &&
        latest.stepId === owner.stepId &&
        latest.locale === owner.locale &&
        latest.voice === owner.voice &&
        latest.mode === "voice" &&
        !latest.busy &&
        snapshot.status === "ready" &&
        snapshot.envelope?.profileId === save?.profileId &&
        snapshot.envelope?.saveId === save?.saveId
      );
    };
    setNotice(null);
    setPhase("requesting");
    getDiagnostics().record({
      source: "input",
      event: "voice.round_started",
      ...context,
      data: { storyId, stepId: step.id, locale },
    });
    try {
      const recognized = await voice.recognize({
        locale,
        signal: current.cancel.signal,
        stopSignal: current.stop.signal,
        context,
        onPhase: (next) => {
          if (isCurrent()) setPhase(next);
        },
      });
      if (!isCurrent()) return;
      // Consume before dispatch. Cancellation after this point cannot undo a saved command.
      round.current = null;
      setPhase(null);
      await acceptRecognized(recognized, context);
    } catch (error) {
      if (!isCurrent()) return;
      const code = error instanceof VoiceInputError ? error.code : "RECOGNITION_FAILED";
      if (code !== "CANCELLED") setNotice({ type: "voiceError", code });
      getDiagnostics().record({
        source: "input",
        event: "voice.round_failed",
        level: "warn",
        ...context,
        data: { code },
      });
    } finally {
      if (round.current === current) {
        round.current = null;
        setPhase(null);
      }
    }
  };

  return (
    <section className="action-input-panel">
      <StoryBlocks blocks={step.blocks} />
      <div className="action-input-panel__modes" role="group" aria-label={t("voice.modeLabel")}>
        {(["text", "voice"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            className="story-button story-button--secondary"
            aria-pressed={mode === entry}
            disabled={busy || submitting}
            onClick={() => {
              cancelVoice();
              setMode(entry);
              setNotice(null);
            }}
          >
            {t(entry === "text" ? "voice.textMode" : "voice.voiceMode")}
          </button>
        ))}
      </div>
      {mode === "voice" ? (
        <div className="action-input-panel__voice">
          <p>{t("voice.hint")}</p>
          {!voice.available ? (
            <p role="status">{t("voice.error.UNAVAILABLE")}</p>
          ) : (
            <>
              <p role="status" aria-live="polite">
                {phase ? t(`voice.phase.${phase}`) : t("voice.ready")}
              </p>
              {phase === null ? (
                <button
                  className="story-button story-button--primary"
                  type="button"
                  disabled={busy || submitting}
                  onClick={() => void startVoice()}
                >
                  {t(submitting ? "story.saving" : "voice.start")}
                </button>
              ) : (
                <div className="action-input-panel__modes">
                  {phase === "recording" ? (
                    <button
                      className="story-button story-button--primary"
                      type="button"
                      onClick={() => {
                        round.current?.stop.abort();
                        setPhase("recognizing");
                      }}
                    >
                      {t("voice.stop")}
                    </button>
                  ) : null}
                  <button
                    className="story-button story-button--secondary"
                    type="button"
                    onClick={() => cancelVoice()}
                  >
                    {t("voice.cancel")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor={`action-input-${step.id}`}>{t("story.inputLabel")}</label>
          <p id={`action-hint-${step.id}`} className="action-input-panel__hint">
            {t("story.inputHint")}
          </p>
          <input
            ref={inputRef}
            id={`action-input-${step.id}`}
            aria-describedby={`action-hint-${step.id}`}
            value={text}
            maxLength={500}
            autoComplete="off"
            disabled={busy || submitting}
            onFocus={() => inputDebug("input.focused")}
            onBlur={() => inputDebug("input.blurred")}
            onChange={(event) => {
              setText(event.target.value);
              const now = performance.now();
              if (now - lastChangeLog.current >= 500) {
                lastChangeLog.current = now;
                inputDebug("input.changed", event.target.value.length);
              }
            }}
            onCompositionStart={() => {
              composing.current = true;
              inputDebug("input.composition_started");
            }}
            onCompositionEnd={() => {
              composing.current = false;
              inputDebug("input.composition_finished");
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)
              )
                event.preventDefault();
            }}
          />
          <button
            className="story-button story-button--primary"
            type="submit"
            disabled={busy || submitting || text.trim().length === 0}
          >
            {t(busy || submitting ? "story.saving" : "story.inputSubmit")}
          </button>
        </form>
      )}
      {notice ? (
        <div
          className="action-input-panel__notice"
          role={notice.type === "error" || notice.type === "voiceError" ? "alert" : "status"}
          aria-live="polite"
        >
          {notice.type === "unknown" ? <p>{t("story.inputUnknown")}</p> : null}
          {notice.type === "voiceError" ? <p>{t(`voice.error.${notice.code}`)}</p> : null}
          {notice.type === "error" ? (
            <p>
              {notice.code === "unexpected"
                ? t("story.completeUnexpectedError")
                : translateSessionError(t, notice.code)}
            </p>
          ) : null}
          {notice.type === "wrong" ? (
            <>
              <p>{t("story.inputWrong")}</p>
              {notice.changes.map((change) => (
                <p key={change.attributeId}>
                  {t("story.inputAttributeChange", {
                    attribute: attributes[change.attributeId]?.label ?? change.attributeId,
                    delta: formatNumber(change.actualDelta, { signDisplay: "always" }),
                  })}
                </p>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
