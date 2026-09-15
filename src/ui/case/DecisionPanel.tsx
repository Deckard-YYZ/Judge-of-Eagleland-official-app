import { useCallback, useEffect, useId, useRef, useState, type Ref } from "react";
import type { GameSessionView } from "../../application/gameSessionView";
import type { ContentNodeView } from "../../application/gameContentView";
import type { CaseId, ChoiceId, NodeId } from "../../content/schema";
import { translateSessionError, useI18n } from "../i18n";
import { AnnotationPopover } from "./AnnotationPopover";

export interface DecisionPanelProps {
  caseId: CaseId;
  nodeId: NodeId;
  node: Readonly<ContentNodeView>;
  dispatch: GameSessionView["dispatch"];
  disabled?: boolean;
  revealDelayMs?: number;
  headingRef?: Ref<HTMLHeadingElement>;
  onCommandError?(message: string | null): void;
}

export const DECISION_REVEAL_DELAY_MS = 2_500;

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
  headingRef,
  onCommandError,
}: DecisionPanelProps) {
  const { t } = useI18n();
  const panelId = useId();
  const choiceElements = useRef(new Map<ChoiceId, HTMLButtonElement>());
  const transientSignals = useRef(new Set<string>());
  const transientCloseTimer = useRef<number | null>(null);
  const submittingRef = useRef(false);
  const revealGateRef = useRef<HTMLDivElement>(null);
  const [submittingChoiceId, setSubmittingChoiceId] = useState<ChoiceId | null>(null);
  const [activeAnnotation, setActiveAnnotation] = useState<ActiveAnnotation | null>(null);
  const revealIdentity = `${caseId}:${nodeId}`;
  const [revealState, setRevealState] = useState<{
    identity: string;
    phase: RevealPhase;
  }>({ identity: revealIdentity, phase: "waiting" });
  const revealPhase =
    revealState.identity === revealIdentity ? revealState.phase : ("waiting" as const);
  const interactionLocked = disabled || submittingChoiceId !== null;
  const annotationPopoverId = `${panelId}-annotation`;

  useEffect(() => {
    const gate = revealGateRef.current;
    let timerId: number | null = null;
    let observer: IntersectionObserver | null = null;
    let active = true;
    let started = false;

    setRevealState({ identity: revealIdentity, phase: "waiting" });

    const beginThinking = (): void => {
      if (!active || started) {
        return;
      }
      started = true;
      observer?.disconnect();
      setRevealState({ identity: revealIdentity, phase: "thinking" });
      timerId = window.setTimeout(
        () => {
          if (active) {
            setRevealState({ identity: revealIdentity, phase: "ready" });
          }
        },
        Math.max(0, revealDelayMs),
      );
    };

    if (!gate || typeof window.IntersectionObserver !== "function") {
      // Older WebViews still reveal choices safely; they begin the same waiting
      // sequence immediately instead of leaving the decision permanently hidden.
      beginThinking();
    } else {
      observer = new window.IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
            beginThinking();
          }
        },
        { threshold: 0.15 },
      );
      observer.observe(gate);
    }

    return () => {
      // A replaced node owns a fresh observer/timer. Invalidating both prevents
      // an old node from revealing controls after a rapid case or node switch.
      active = false;
      observer?.disconnect();
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [revealDelayMs, revealIdentity]);

  const registerChoiceElement =
    (choiceId: ChoiceId) =>
    (element: HTMLButtonElement | null): void => {
      if (element) {
        choiceElements.current.set(choiceId, element);
      } else {
        choiceElements.current.delete(choiceId);
      }
    };

  const clearTransientCloseTimer = (): void => {
    if (transientCloseTimer.current !== null) {
      window.clearTimeout(transientCloseTimer.current);
      transientCloseTimer.current = null;
    }
  };

  const showTransientAnnotation = (
    choiceId: ChoiceId,
    anchorElement: HTMLElement,
    source: "hover" | "focus",
  ): void => {
    transientSignals.current.add(`${source}:${choiceId}`);
    clearTransientCloseTimer();
    setActiveAnnotation((current) => {
      if (current?.choiceId === choiceId && current.anchorElement === anchorElement) {
        return current;
      }

      return { caseId, nodeId, choiceId, anchorElement };
    });
  };

  const hideTransientAnnotation = (choiceId: ChoiceId, source: "hover" | "focus"): void => {
    transientSignals.current.delete(`${source}:${choiceId}`);
    clearTransientCloseTimer();
    transientCloseTimer.current = window.setTimeout(() => {
      transientCloseTimer.current = null;
      setActiveAnnotation((current) => {
        const hasRemainingSignal =
          transientSignals.current.has(`hover:${choiceId}`) ||
          transientSignals.current.has(`focus:${choiceId}`);

        return current?.choiceId === choiceId && !hasRemainingSignal ? null : current;
      });
    }, 120);
  };

  const dismissAnnotation = useCallback((): void => {
    setActiveAnnotation(null);
  }, []);

  useEffect(() => {
    transientSignals.current.clear();
    clearTransientCloseTimer();
    setActiveAnnotation(null);
  }, [caseId, nodeId]);

  useEffect(
    () => () => {
      clearTransientCloseTimer();
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

    setActiveAnnotation(null);
    submittingRef.current = true;
    setSubmittingChoiceId(choiceId);
    onCommandError?.(null);

    try {
      const result = await dispatch({ type: "chooseOption", caseId, nodeId, choiceId });
      if (!result.ok) {
        onCommandError?.(translateSessionError(t, result.code));
      }
    } finally {
      submittingRef.current = false;
      setSubmittingChoiceId(null);
    }
  };

  return (
    <section
      className="decision-panel"
      aria-labelledby={panelId}
      aria-busy={submittingChoiceId !== null}
      data-case-id={caseId}
      data-node-id={nodeId}
    >
      <p className="kicker">{t("decision.kicker")}</p>
      <h2 ref={headingRef} id={panelId} className="decision-panel__title" tabIndex={-1}>
        {node.prompt ?? t("decision.fallbackPrompt")}
      </h2>

      <div className="decision-reveal" ref={revealGateRef} data-reveal-phase={revealPhase}>
        {revealPhase === "ready" ? (
          <fieldset className="decision-panel__choices" disabled={interactionLocked}>
            <legend className="sr-only">{t("decision.optionsLegend")}</legend>
            {node.choices.map((choice) => {
              const choiceDomId = `${panelId}-choice-${domToken(choice.id)}`;
              const isAnnotationActive = activeAnnotation?.choiceId === choice.id;

              return (
                <div
                  key={choice.id}
                  className="decision-option"
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
                    data-choice-anchor="true"
                    data-case-id={caseId}
                    data-node-id={nodeId}
                    data-choice-id={choice.id}
                    data-has-annotation={choice.annotation ? "true" : "false"}
                    aria-describedby={isAnnotationActive ? annotationPopoverId : undefined}
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
                </div>
              );
            })}
          </fieldset>
        ) : (
          <div className={`decision-thinking decision-thinking--${revealPhase}`} role="status">
            <span className="decision-thinking__label">
              {t(revealPhase === "waiting" ? "decision.waiting" : "decision.thinking")}
            </span>
            {revealPhase === "thinking" ? (
              <span className="decision-thinking__dots" aria-label={t("decision.thinkingAria")}>
                <i />
                <i />
                <i />
              </span>
            ) : null}
          </div>
        )}
      </div>

      {submittingChoiceId ? (
        <p className="decision-panel__status" role="status">
          {t("decision.saving")}
        </p>
      ) : null}

      {activeAnnotation?.caseId === caseId && activeAnnotation.nodeId === nodeId
        ? (() => {
            const choice = node.choices.find(
              (candidate) => candidate.id === activeAnnotation.choiceId,
            );

            return choice?.annotation ? (
              <AnnotationPopover
                id={annotationPopoverId}
                annotation={choice.annotation}
                anchorElement={activeAnnotation.anchorElement}
                pinned={false}
                onDismiss={dismissAnnotation}
                onMouseEnter={clearTransientCloseTimer}
                onMouseLeave={() => hideTransientAnnotation(activeAnnotation.choiceId, "hover")}
              />
            ) : null;
          })()
        : null}
    </section>
  );
}
