import type { DecisionPresentationHistory, PresentationMode } from "./presentationPolicy";
import { useCallback, useEffect, useMemo, useId, useRef, useState, type Ref } from "react";
import type { GameSessionView } from "../../application/gameSessionView";
import type { ContentNodeView } from "../../application/gameContentView";
import type { CaseId, ChoiceId, NodeId } from "../../content/schema";
import { translateSessionError, useI18n } from "../i18n";
import { observeReviewPresence } from "./observeReviewVisibility";
import { AnnotationPopover } from "./AnnotationPopover";
import { TextBlockList } from "./TextBlocks";
import encryptAiIcon from "../assets/icons/interlocked_rectangular_rings_small.svg";

export interface DecisionPanelProps {
  caseId: CaseId;
  nodeId: NodeId;
  node: Readonly<ContentNodeView>;
  dispatch: GameSessionView["dispatch"];
  disabled?: boolean;
  revealDelayMs?: number;
  presentationMode?: PresentationMode;
  presentationHistory?: DecisionPresentationHistory;
  presentationIdentity?: string;
  thinkingStartedAt?: number;
  headingRef?: Ref<HTMLHeadingElement>;
  onCommandError?(message: string | null): void;
}

export const DECISION_REVEAL_DELAY_MS = 750;

type RevealPhase = "waiting" | "thinking" | "ready";

const domToken = (value: string): string => encodeURIComponent(value).replaceAll("%", "_");

interface ActiveAnnotation {
  caseId: CaseId;
  nodeId: NodeId;
  choiceId: ChoiceId;
  anchorElement: HTMLElement;
}

export function DecisionPanel({
  caseId,
  nodeId,
  node,
  dispatch,
  disabled = false,
  revealDelayMs = DECISION_REVEAL_DELAY_MS,
  presentationMode = "normal",
  presentationHistory,
  presentationIdentity,
  thinkingStartedAt,
  headingRef,
  onCommandError,
}: DecisionPanelProps) {
  // CaseReader mounts this component with a content/case/node key. Local presentation state
  // lasts for that round; localization replaces its copy without changing the key.
  const { t } = useI18n();
  const panelId = useId();
  const choiceElements = useRef(new Map<ChoiceId, HTMLButtonElement>());
  const transientSignals = useRef(new Set<string>());
  const submittingRef = useRef(false);
  const revealGateRef = useRef<HTMLDivElement>(null);
  const [submittingChoiceId, setSubmittingChoiceId] = useState<ChoiceId | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [instructionVisible, setInstructionVisible] = useState(false);
  const [choiceCommitted, setChoiceCommitted] = useState(false);
  const instructionId = node.instruction?.id;
  const instructionDelayMs = node.instruction?.delayMs;
  const failedChoiceRef = useRef<ChoiceId | null>(null);
  const [activeAnnotation, setActiveAnnotation] = useState<ActiveAnnotation | null>(null);
  const revealIdentity = presentationIdentity ?? JSON.stringify([caseId, nodeId]);
  const revealScope = useMemo(
    () => ({ identity: revealIdentity }),
    [revealIdentity, presentationHistory],
  );
  const [presence, setPresence] = useState<{
    identity: typeof revealScope;
    visible: boolean;
  } | null>(null);
  const visible = presence?.identity === revealScope && presence.visible;
  const [preparation, setPreparation] = useState<{
    identity: typeof revealScope;
    complete: boolean;
  } | null>(null);
  const [shownIdentity, setShownIdentity] = useState<typeof revealScope | null>(null);
  const startedAt = useRef<{ identity: typeof revealScope; time: number } | null>(null);
  const alreadyShown = presentationHistory?.has(revealIdentity) ?? false;
  const delayMs = presentationMode === "immediate" || alreadyShown ? 0 : revealDelayMs;
  const prepared = preparation?.identity === revealScope && preparation.complete;
  const revealPhase: RevealPhase =
    shownIdentity === revealScope || (prepared && visible && !disabled)
      ? "ready"
      : preparation?.identity === revealScope
        ? "thinking"
        : "waiting";
  const interactionLocked = disabled || submittingChoiceId !== null;
  const annotationPopoverId = `${panelId}-annotation`;
  const instructionDomId = `${panelId}-instruction`;

  useEffect(() => {
    if (
      revealPhase !== "ready" ||
      instructionId === undefined ||
      instructionDelayMs === undefined ||
      choiceCommitted
    )
      return;
    // Scalar dependencies keep a language projection from restarting this round's timer.
    const timer = window.setTimeout(() => setInstructionVisible(true), instructionDelayMs);
    return () => window.clearTimeout(timer);
  }, [revealPhase, instructionId, instructionDelayMs, choiceCommitted]);

  useEffect(() => {
    const gate = revealGateRef.current;
    return gate
      ? observeReviewPresence(gate, (visible) => setPresence({ identity: revealScope, visible }))
      : undefined;
  }, [revealScope]);

  useEffect(() => {
    if (!visible || disabled || shownIdentity === revealScope || prepared) return;
    if (startedAt.current?.identity !== revealScope) {
      startedAt.current = { identity: revealScope, time: thinkingStartedAt ?? Date.now() };
    }
    setPreparation({ identity: revealScope, complete: false });
    const remaining = Math.max(0, delayMs - Math.max(0, Date.now() - startedAt.current.time));
    const timerId = window.setTimeout(() => {
      setPreparation({ identity: revealScope, complete: true });
    }, remaining);
    return () => window.clearTimeout(timerId);
  }, [visible, disabled, revealScope, delayMs, thinkingStartedAt, shownIdentity, prepared]);

  // Effects run after candidate DOM has committed. Timer completion alone never
  // marks a node; hidden, failed or uncommitted work cannot suppress a later wait.
  useEffect(() => {
    if (revealPhase !== "ready" || !visible || disabled) return;
    setShownIdentity(revealScope);
    presentationHistory?.mark(revealIdentity);
  }, [revealPhase, visible, disabled, revealScope, revealIdentity, presentationHistory]);

  const registerChoiceElement =
    (choiceId: ChoiceId) =>
    (element: HTMLButtonElement | null): void => {
      if (element) {
        choiceElements.current.set(choiceId, element);
      } else {
        choiceElements.current.delete(choiceId);
      }
    };

  const showTransientAnnotation = (
    choiceId: ChoiceId,
    anchorElement: HTMLElement,
    source: "hover" | "focus",
  ): void => {
    if (interactionLocked || submittingRef.current) return;
    transientSignals.current.add(`${source}:${choiceId}`);
    setActiveAnnotation((current) => {
      if (current?.choiceId === choiceId && current.anchorElement === anchorElement) {
        return current;
      }

      return { caseId, nodeId, choiceId, anchorElement };
    });
  };

  const hideTransientAnnotation = (choiceId: ChoiceId, source: "hover" | "focus"): void => {
    transientSignals.current.delete(`${source}:${choiceId}`);
    setActiveAnnotation((current) => {
      const hasRemainingSignal =
        transientSignals.current.has(`hover:${choiceId}`) ||
        transientSignals.current.has(`focus:${choiceId}`);
      return current?.choiceId === choiceId && !hasRemainingSignal ? null : current;
    });
  };

  const dismissAnnotation = useCallback((): void => {
    transientSignals.current.clear();
    setActiveAnnotation(null);
  }, []);

  useEffect(() => {
    transientSignals.current.clear();
    setActiveAnnotation(null);
  }, [caseId, nodeId]);

  useEffect(
    () => () => {
      transientSignals.current.clear();
    },
    [],
  );

  useEffect(() => {
    setActiveAnnotation((current) => {
      if (!current) {
        return null;
      }

      const currentChoice = node.choices.find((choice) => choice.id === current.choiceId);
      return current.caseId === caseId &&
        current.nodeId === nodeId &&
        currentChoice?.annotation &&
        current.anchorElement.isConnected
        ? current
        : null;
    });
  }, [caseId, node.choices, nodeId]);

  const choose = async (choiceId: ChoiceId): Promise<void> => {
    // Stale-click boundary: capture all three IDs from this rendered node. Never
    // look up a newer node after awaiting, so the application layer can reject it.
    if (disabled || submittingRef.current) {
      return;
    }

    transientSignals.current.clear();
    setActiveAnnotation(null);
    setCommandError(null);
    failedChoiceRef.current = null;
    submittingRef.current = true;
    setSubmittingChoiceId(choiceId);
    onCommandError?.(null);

    try {
      const result = await dispatch({ type: "chooseOption", caseId, nodeId, choiceId });
      if (!result.ok) {
        const message = translateSessionError(t, result.code);
        setCommandError(message);
        failedChoiceRef.current = choiceId;
        onCommandError?.(message);
      } else {
        setChoiceCommitted(true);
        setInstructionVisible(false);
      }
    } catch {
      const message = t("decision.submitFailed");
      setCommandError(message);
      failedChoiceRef.current = choiceId;
      onCommandError?.(message);
    } finally {
      submittingRef.current = false;
      setSubmittingChoiceId(null);
    }
  };

  useEffect(() => {
    if (submittingChoiceId === null && failedChoiceRef.current) {
      choiceElements.current.get(failedChoiceRef.current)?.focus();
      failedChoiceRef.current = null;
    }
  }, [submittingChoiceId, commandError]);

  return (
    <section
      className="decision-panel"
      aria-labelledby={panelId}
      data-case-id={caseId}
      data-node-id={nodeId}
      data-submitting={submittingChoiceId !== null}
    >
      <p className="kicker">{t("decision.kicker")}</p>
      <h2 ref={headingRef} id={panelId} className="decision-panel__title" tabIndex={-1}>
        {node.prompt ?? t("decision.fallbackPrompt")}
      </h2>

      <div className="decision-reveal" ref={revealGateRef} data-reveal-phase={revealPhase}>
        {revealPhase === "ready" ? (
          <div className="decision-options-revealed">
            <fieldset
              className="decision-panel__choices"
              disabled={interactionLocked}
              aria-busy={submittingChoiceId !== null}
            >
              <legend className="sr-only">{t("decision.optionsLegend")}</legend>
              {node.choices.map((choice) => {
                const choiceDomId = `${panelId}-choice-${domToken(choice.id)}`;
                const isAnnotationActive = activeAnnotation?.choiceId === choice.id;
                const showInstruction =
                  instructionVisible &&
                  !choiceCommitted &&
                  node.instruction?.choiceId === choice.id;

                return (
                  <div
                    key={choice.id}
                    className={`decision-option${showInstruction ? " decision-option--instructed" : ""}`}
                    data-choice-container="true"
                    data-choice-id={choice.id}
                    onMouseEnter={() => {
                      if (!choice.annotation) {
                        return;
                      }

                      const anchorElement = choiceElements.current.get(choice.id);
                      if (anchorElement) {
                        showTransientAnnotation(choice.id, anchorElement, "hover");
                      }
                    }}
                    onMouseLeave={() => {
                      if (choice.annotation) {
                        hideTransientAnnotation(choice.id, "hover");
                      }
                    }}
                  >
                    <button
                      ref={registerChoiceElement(choice.id)}
                      id={choiceDomId}
                      className="decision-option__button"
                      type="button"
                      onClick={() => void choose(choice.id)}
                      data-submitting={submittingChoiceId === choice.id}
                      data-choice-anchor="true"
                      data-case-id={caseId}
                      data-node-id={nodeId}
                      data-choice-id={choice.id}
                      data-has-annotation={choice.annotation ? "true" : "false"}
                      aria-describedby={
                        [
                          isAnnotationActive ? annotationPopoverId : "",
                          showInstruction ? instructionDomId : "",
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                      onFocus={(event) => {
                        if (choice.annotation) {
                          showTransientAnnotation(choice.id, event.currentTarget, "focus");
                        }
                      }}
                      onBlur={() => {
                        if (choice.annotation) {
                          hideTransientAnnotation(choice.id, "focus");
                        }
                      }}
                    >
                      <span>{choice.text}</span>
                      <span className="decision-option__mark" aria-hidden="true">
                        {t(
                          submittingChoiceId === choice.id
                            ? "decision.markSaving"
                            : "decision.markReady",
                        )}
                      </span>
                    </button>
                    {showInstruction && node.instruction ? (
                      <aside
                        id={instructionDomId}
                        className="decision-instruction"
                        role="note"
                        data-instruction-id={node.instruction.id}
                      >
                        <TextBlockList blocks={node.instruction.blocks} />
                      </aside>
                    ) : null}
                  </div>
                );
              })}
            </fieldset>
            <p className="decision-panel__attribution">
              <span>{t("decision.poweredBy")}</span>
              <img
                className="decision-panel__attribution-icon"
                src={encryptAiIcon}
                alt=""
                aria-hidden="true"
              />
            </p>
          </div>
        ) : (
          <div className={`decision-thinking decision-thinking--${revealPhase}`} role="status">
            <span className="decision-thinking__label">
              {t(revealPhase === "waiting" ? "decision.waiting" : "decision.thinking")}
            </span>
          </div>
        )}
      </div>

      <p
        hidden={revealPhase !== "ready"}
        className="decision-panel__status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {submittingChoiceId ? t("decision.saving") : ""}
      </p>
      {commandError && !onCommandError ? <p role="alert">{commandError}</p> : null}

      {!interactionLocked &&
      activeAnnotation?.caseId === caseId &&
      activeAnnotation.nodeId === nodeId
        ? (() => {
            const choice = node.choices.find(
              (candidate) => candidate.id === activeAnnotation.choiceId,
            );

            return choice?.annotation ? (
              <AnnotationPopover
                id={annotationPopoverId}
                annotation={choice.annotation}
                anchorElement={activeAnnotation.anchorElement}
                onDismiss={dismissAnnotation}
              />
            ) : null;
          })()
        : null}
    </section>
  );
}
