import type { CaseId } from "../content/schema";
import type { FeedbackRequest, GameCommand } from "../game/commands";
import type { GameSession, GameSessionDispatchResult, GameSessionSnapshot } from "./gameSession";

export type GameSessionViewSnapshot = GameSessionSnapshot &
  Readonly<{
    /** UI selection only. It is deliberately absent from the persisted GameState. */
    selectedCaseId: CaseId | null;
  }>;

/**
 * The complete wall between React and the application/session implementation.
 * UI callers can read committed state, select a document and send commands, but
 * cannot reach repositories, fixture paths or platform services through this API.
 */
export interface GameSessionView {
  getSnapshot(): GameSessionViewSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeFeedback(listener: (feedback: readonly FeedbackRequest[]) => void): () => void;
  selectCase(caseId: CaseId | null): void;
  dispatch(command: GameCommand): Promise<GameSessionDispatchResult>;
}

const availableCaseIds = (snapshot: GameSessionSnapshot): readonly CaseId[] => {
  if (!snapshot.state || !snapshot.content) {
    return [];
  }

  return Object.keys(snapshot.state.cases)
    .filter((caseId) => snapshot.content.cases[caseId] !== undefined)
    .sort((left, right) => {
      const orderDelta = snapshot.content.cases[left].order - snapshot.content.cases[right].order;
      return orderDelta || left.localeCompare(right);
    });
};

const selectValidCase = (
  snapshot: GameSessionSnapshot,
  selectedCaseId: CaseId | null,
): CaseId | null => {
  const ids = availableCaseIds(snapshot);
  return selectedCaseId && ids.includes(selectedCaseId) ? selectedCaseId : (ids[0] ?? null);
};

const createSnapshot = (
  snapshot: GameSessionSnapshot,
  selectedCaseId: CaseId | null,
): GameSessionViewSnapshot => Object.freeze({ ...snapshot, selectedCaseId });

export const createGameSessionView = (session: GameSession): GameSessionView => {
  let sessionSnapshot = session.getSnapshot();
  let selectedCaseId = selectValidCase(sessionSnapshot, null);
  let snapshot = createSnapshot(sessionSnapshot, selectedCaseId);
  const listeners = new Set<() => void>();

  const publish = (nextSnapshot: GameSessionViewSnapshot): void => {
    snapshot = nextSnapshot;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A rendering observer cannot alter application state or notification order.
      }
    }
  };

  session.subscribe(() => {
    sessionSnapshot = session.getSnapshot();
    selectedCaseId = selectValidCase(sessionSnapshot, selectedCaseId);
    publish(createSnapshot(sessionSnapshot, selectedCaseId));
  });

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeFeedback: (listener) => session.subscribeFeedback(listener),
    selectCase: (caseId) => {
      // Saving locks document switching just as it locks commands. In all other
      // committed-state views, selection is allowed only for an unlocked case.
      if (sessionSnapshot.status === "saving") {
        return;
      }

      const nextCaseId =
        caseId === null
          ? null
          : availableCaseIds(sessionSnapshot).includes(caseId)
            ? caseId
            : selectedCaseId;
      if (nextCaseId === selectedCaseId) {
        return;
      }

      selectedCaseId = nextCaseId;
      publish(createSnapshot(sessionSnapshot, selectedCaseId));
    },
    dispatch: (command) => session.dispatch(command),
  };
};
