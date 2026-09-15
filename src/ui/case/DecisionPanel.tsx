import { useCallback, useEffect, useId, useRef, useState, type Ref } from "react";
import type { GameSessionView } from "../../application/gameSessionView";
import type { CaseId, ChoiceId, DecisionNode, NodeId } from "../../content/schema";
import { AnnotationPopover } from "./AnnotationPopover";

export interface DecisionPanelProps {
  caseId: CaseId;
  nodeId: NodeId;
  node: Readonly<DecisionNode>;
  dispatch: GameSessionView["dispatch"];
  disabled?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  onCommandError?(message: string | null): void;
}

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
  headingRef,
  onCommandError,
}: DecisionPanelProps) {
  const panelId = useId();
  const choiceElements = useRef(new Map<ChoiceId, HTMLButtonElement>());
  const transientSignals = useRef(new Set<string>());
  const transientCloseTimer = useRef<number | null>(null);
  const submittingRef = useRef(false);
  const [submittingChoiceId, setSubmittingChoiceId] = useState<ChoiceId | null>(null);
  const [activeAnnotation, setActiveAnnotation] = useState<ActiveAnnotation | null>(null);
  const interactionLocked = disabled || submittingChoiceId !== null;
  const annotationPopoverId = `${panelId}-annotation`;

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
        onCommandError?.(result.message);
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
      <p className="kicker">Decision required</p>
      <h2 ref={headingRef} id={panelId} className="decision-panel__title" tabIndex={-1}>
        {node.prompt ?? "请选择裁定方向"}
      </h2>

      <fieldset className="decision-panel__choices" disabled={interactionLocked}>
        <legend className="sr-only">裁定选项</legend>
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
                  {submittingChoiceId === choice.id ? "存" : "裁"}
                </span>
              </button>
            </div>
          );
        })}
      </fieldset>

      {submittingChoiceId ? (
        <p className="decision-panel__status" role="status">
          正在归档裁定…
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
