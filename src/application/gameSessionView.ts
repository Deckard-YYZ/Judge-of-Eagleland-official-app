import type { CaseId, ContentLocale } from "../content/schema";
import type { SplitContentRepository } from "../content/repository";
import type { FeedbackRequest, GameCommand } from "../game/commands";
import { DEFAULT_LOCALE } from "../shared/locale";
import { createGameContentView, type GameContentView } from "./gameContentView";
import type {
  GameSession,
  GameSessionDispatchResult,
  GameSessionError,
  GameSessionSnapshot,
} from "./gameSession";

export interface LocalizationViewError {
  readonly code: "LOCALIZATION_LOAD_FAILED";
  readonly message: string;
  readonly requestedLocale: ContentLocale;
}

export type GameSessionViewSnapshot = Readonly<{
  status: GameSessionSnapshot["status"];
  envelope: GameSessionSnapshot["envelope"];
  state: GameSessionSnapshot["state"];
  /** Presentation-only content; rule targets/effects never cross this wall. */
  content: Readonly<GameContentView> | null;
  error: Readonly<GameSessionError> | null;
  localizationStatus: "idle" | "loading" | "ready" | "fallback" | "error";
  localizationError: Readonly<LocalizationViewError> | null;
  selectedCaseId: CaseId | null;
}>;

export interface GameSessionView {
  getSnapshot(): GameSessionViewSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeFeedback(listener: (feedback: readonly FeedbackRequest[]) => void): () => void;
  selectCase(caseId: CaseId | null): void;
  setLocale(locale: ContentLocale): Promise<void>;
  dispatch(command: GameCommand): Promise<GameSessionDispatchResult>;
}

const availableCaseIds = (snapshot: GameSessionSnapshot): readonly CaseId[] => {
  if (!snapshot.state || !snapshot.content) return [];
  return Object.keys(snapshot.state.cases)
    .filter((caseId) => snapshot.content?.cases[caseId] !== undefined)
    .sort((left, right) => {
      const orderDelta = snapshot.content!.cases[left].order - snapshot.content!.cases[right].order;
      return orderDelta || left.localeCompare(right);
    });
};

const selectValidCase = (
  snapshot: GameSessionSnapshot,
  selectedCaseId: CaseId | null,
): CaseId | null => {
  const ids = availableCaseIds(snapshot);
  return selectedCaseId && ids.includes(selectedCaseId) ? selectedCaseId : null;
};

const deepFreeze = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (value === null || typeof value !== "object" || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const child of Object.values(value as object)) deepFreeze(child, seen);
  return Object.freeze(value);
};

export const createGameSessionView = (
  session: GameSession,
  contentRepository: SplitContentRepository,
  initialLocale: ContentLocale = DEFAULT_LOCALE,
): GameSessionView => {
  let sessionSnapshot = session.getSnapshot();
  let selectedCaseId: CaseId | null = null;
  let requestedLocale = initialLocale;
  let content: Readonly<GameContentView> | null = null;
  let localizationStatus: GameSessionViewSnapshot["localizationStatus"] = "idle";
  let localizationError: Readonly<LocalizationViewError> | null = null;
  let projectedRules: GameSessionSnapshot["content"] = null;
  let requestVersion = 0;
  const listeners = new Set<() => void>();

  const makeSnapshot = (): GameSessionViewSnapshot =>
    Object.freeze({
      status: sessionSnapshot.status,
      envelope: sessionSnapshot.envelope,
      state: sessionSnapshot.state,
      content,
      error: sessionSnapshot.error,
      localizationStatus,
      localizationError,
      selectedCaseId,
    });
  let snapshot = makeSnapshot();

  const publish = (): void => {
    snapshot = makeSnapshot();
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // Rendering observers cannot alter session facts or localization ordering.
      }
    }
  };

  const refreshLocalization = async (): Promise<void> => {
    const rules = sessionSnapshot.content;
    const ref = sessionSnapshot.envelope?.contentRef;
    const version = ++requestVersion;
    const canKeepCommittedPresentation = content !== null && projectedRules === rules;
    if (!canKeepCommittedPresentation) {
      content = null;
      projectedRules = null;
    }
    localizationError = null;
    localizationStatus = rules && ref ? "loading" : "idle";
    publish();
    if (!rules || !ref) return;

    const load = async (locale: ContentLocale) => contentRepository.loadLocalization(ref, locale);
    try {
      const localized = await load(requestedLocale);
      if (version !== requestVersion) return;
      content = deepFreeze(createGameContentView(rules, localized));
      projectedRules = rules;
      localizationStatus = "ready";
      publish();
    } catch (error) {
      if (version !== requestVersion) return;
      const failure: LocalizationViewError = {
        code: "LOCALIZATION_LOAD_FAILED",
        message:
          error instanceof Error ? error.message : "The content language could not be loaded.",
        requestedLocale,
      };
      const fallbackLocale = rules.manifest.defaultLocale;
      if (fallbackLocale !== requestedLocale) {
        try {
          const localized = await load(fallbackLocale);
          if (version !== requestVersion) return;
          content = deepFreeze(createGameContentView(rules, localized));
          projectedRules = rules;
          localizationStatus = "fallback";
          localizationError = Object.freeze(failure);
          publish();
          return;
        } catch {
          // The typed error below represents both requested and fallback load failure.
        }
      }
      if (version !== requestVersion) return;
      localizationStatus = "error";
      localizationError = Object.freeze(failure);
      publish();
    }
  };

  session.subscribe(() => {
    const previousRules = sessionSnapshot.content;
    sessionSnapshot = session.getSnapshot();
    selectedCaseId = selectValidCase(sessionSnapshot, selectedCaseId);
    if (
      sessionSnapshot.content !== previousRules ||
      !content ||
      projectedRules !== sessionSnapshot.content
    ) {
      void refreshLocalization();
    } else {
      publish();
    }
  });

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeFeedback: (listener) => session.subscribeFeedback(listener),
    selectCase: (caseId) => {
      if (sessionSnapshot.status === "saving") return;
      const nextCaseId =
        caseId === null
          ? null
          : availableCaseIds(sessionSnapshot).includes(caseId)
            ? caseId
            : selectedCaseId;
      if (nextCaseId === selectedCaseId) return;
      selectedCaseId = nextCaseId;
      publish();
    },
    setLocale: async (locale) => {
      if (locale === requestedLocale && content?.locale === locale) return;
      requestedLocale = locale;
      await refreshLocalization();
    },
    dispatch: (command) => session.dispatch(command),
  };
};
