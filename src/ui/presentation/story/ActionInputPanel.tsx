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
import { getDiagnostics } from "../../../shared/diagnostics";

interface ActionInputPanelProps {
  sessionView: GameSessionView;
  storyId: string;
  step: Extract<ContentStoryStepView, { type: "actionInput" }>;
  attributes: Readonly<Record<string, ContentAttributeView>>;
  busy: boolean;
}

type InputNotice =
  | { type: "unknown" }
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
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<InputNotice | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const inFlight = useRef(false);
  const operationVersion = useRef(0);
  const lastChangeLog = useRef(0);
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
    setNotice(null);
    setText("");
    return () => {
      operationVersion.current += 1;
    };
  }, [sessionView, storyId, step.id]);

  useEffect(() => {
    setText("");
    // A language change starts the next recognition round; it never cancels a saved command.
  }, [locale]);

  useEffect(() => {
    if (!busy && !submitting) inputRef.current?.focus();
  }, [busy, submitting]);

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

  return (
    <section className="action-input-panel">
      <StoryBlocks blocks={step.blocks} />
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
      {notice ? (
        <div
          className="action-input-panel__notice"
          role={notice.type === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {notice.type === "unknown" ? <p>{t("story.inputUnknown")}</p> : null}
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
