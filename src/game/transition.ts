import { finishCurrentStory, getNextRequiredInput, submitStoryInput } from "./storyInput";
import type { GameContentCatalog } from "../content/schema";
import type {
  GameCommand,
  FeedbackRequest,
  Transition,
  TransitionContext,
  TransitionErrorCode,
  TransitionResult,
} from "./commands";
import { checkGameStateInvariants, type GameStateInvariantIssue } from "./invariants";
import type { GameState } from "./model";
import { resolveFinalChoice, type ResolutionIssue } from "./resolution";

const reject = (code: TransitionErrorCode, message: string): TransitionResult => ({
  ok: false,
  code,
  message,
});

const describeInvariantIssue = (issue: GameStateInvariantIssue): string => {
  const location = issue.path.length > 0 ? issue.path.join(".") : "state";
  return `${location}: ${issue.message}`;
};

const describeResolutionIssue = (issue: ResolutionIssue): string => {
  const location = issue.path.length > 0 ? issue.path.join(".") : "resolution";
  return `${location}: ${issue.message}`;
};

const accept = (
  nextState: GameState,
  content: Readonly<GameContentCatalog>,
  feedback: readonly FeedbackRequest[] = [],
): TransitionResult => {
  const invariantResult = checkGameStateInvariants(nextState, content);
  return invariantResult.ok
    ? { ok: true, nextState, feedback: [...feedback] }
    : reject(
        "CONTENT_INVALID",
        `Transition produced an invalid game state (${describeInvariantIssue(invariantResult.issues[0])}).`,
      );
};

const rejectBlockedCaseCommand = (state: Readonly<GameState>): TransitionResult | null => {
  // A locked ending outranks story blocking: no case command is valid once the run is finishing.
  if (state.phase.type !== "playing") {
    return reject("RUN_FINISHED", "The run no longer accepts case commands.");
  }
  if (state.pendingStoryIds.length > 0) {
    return reject("STORY_BLOCKING", "Complete the current story before handling a case.");
  }
  return null;
};

const startCase = (
  state: Readonly<GameState>,
  command: Extract<GameCommand, { type: "startCase" }>,
  content: Readonly<GameContentCatalog>,
): TransitionResult => {
  const blocked = rejectBlockedCaseCommand(state);
  if (blocked) {
    return blocked;
  }

  const progress = state.cases[command.caseId];
  if (!progress) {
    return reject("CASE_LOCKED", `Case "${command.caseId}" has not been unlocked.`);
  }

  const definition = content.cases[command.caseId];
  if (!definition) {
    return reject(
      "CONTENT_INVALID",
      `Unlocked case "${command.caseId}" is missing from the content catalog.`,
    );
  }
  if (progress.status === "resolved") {
    return reject("CASE_ALREADY_RESOLVED", `Case "${command.caseId}" is already resolved.`);
  }
  if (progress.status === "active") {
    return reject("CASE_ALREADY_STARTED", `Case "${command.caseId}" is already active.`);
  }
  if (!definition.nodes[definition.startNodeId]) {
    return reject(
      "CONTENT_INVALID",
      `Case "${command.caseId}" references missing start node "${definition.startNodeId}".`,
    );
  }

  return accept(
    {
      ...state,
      cases: {
        ...state.cases,
        [command.caseId]: {
          status: "active",
          currentNodeId: definition.startNodeId,
          history: [],
        },
      },
    },
    content,
  );
};

type ResolutionChoiceHandler = (
  state: Readonly<GameState>,
  command: Extract<GameCommand, { type: "chooseOption" }>,
  content: Readonly<GameContentCatalog>,
  context: TransitionContext,
) => TransitionResult;

const handleResolutionChoice: ResolutionChoiceHandler = (state, command, content, context) => {
  const result = resolveFinalChoice(
    state,
    {
      caseId: command.caseId,
      nodeId: command.nodeId,
      choiceId: command.choiceId,
    },
    content,
    context,
  );
  if (!result.ok) {
    return reject(
      "CONTENT_INVALID",
      `Cannot settle final choice (${describeResolutionIssue(result.issues[0])}).`,
    );
  }

  const feedback: FeedbackRequest[] =
    result.changes.length > 0
      ? [
          {
            type: "attributeFeedback",
            source: { type: "case", caseId: command.caseId },
            changes: [...result.changes],
          },
        ]
      : [];
  return accept(result.nextState, content, feedback);
};

const chooseOption = (
  state: Readonly<GameState>,
  command: Extract<GameCommand, { type: "chooseOption" }>,
  content: Readonly<GameContentCatalog>,
  context: TransitionContext,
): TransitionResult => {
  const blocked = rejectBlockedCaseCommand(state);
  if (blocked) {
    return blocked;
  }

  const progress = state.cases[command.caseId];
  if (!progress) {
    return reject("CASE_LOCKED", `Case "${command.caseId}" has not been unlocked.`);
  }

  const definition = content.cases[command.caseId];
  if (!definition) {
    return reject(
      "CONTENT_INVALID",
      `Unlocked case "${command.caseId}" is missing from the content catalog.`,
    );
  }
  if (progress.status === "resolved") {
    return reject("CASE_ALREADY_RESOLVED", `Case "${command.caseId}" is already resolved.`);
  }
  if (progress.status !== "active") {
    return reject("INVALID_CHOICE", `Case "${command.caseId}" must be started before choosing.`);
  }
  if (progress.currentNodeId !== command.nodeId) {
    return reject(
      "STALE_CHOICE",
      `Choice came from node "${command.nodeId}", but case "${command.caseId}" is at "${progress.currentNodeId}".`,
    );
  }

  const node = definition.nodes[progress.currentNodeId];
  if (!node) {
    return reject(
      "CONTENT_INVALID",
      `Case "${command.caseId}" references missing current node "${progress.currentNodeId}".`,
    );
  }

  const choice = node.choices.find((candidate) => candidate.id === command.choiceId);
  if (!choice) {
    return reject(
      "INVALID_CHOICE",
      `Choice "${command.choiceId}" does not exist on node "${command.nodeId}".`,
    );
  }
  if (choice.target.type === "resolution") {
    return handleResolutionChoice(state, command, content, context);
  }
  if (!definition.nodes[choice.target.nodeId]) {
    return reject(
      "CONTENT_INVALID",
      `Choice "${choice.id}" targets missing node "${choice.target.nodeId}".`,
    );
  }

  return accept(
    {
      ...state,
      cases: {
        ...state.cases,
        [command.caseId]: {
          status: "active",
          currentNodeId: choice.target.nodeId,
          history: [...progress.history, { nodeId: command.nodeId, choiceId: command.choiceId }],
        },
      },
    },
    content,
  );
};

const completeStory = (
  state: Readonly<GameState>,
  command: Extract<GameCommand, { type: "completeStory" }>,
  content: Readonly<GameContentCatalog>,
): TransitionResult => {
  if (state.phase.type === "ended") {
    return reject("RUN_FINISHED", "The run has already ended.");
  }
  if (!content.stories[command.storyId]) {
    return reject(
      "CONTENT_INVALID",
      `Story "${command.storyId}" is missing from the content catalog.`,
    );
  }
  if (state.pendingStoryIds[0] !== command.storyId) {
    return reject(
      "INVALID_STORY_COMPLETION",
      `Story "${command.storyId}" is not the first pending story.`,
    );
  }

  if (
    getNextRequiredInput(
      command.storyId,
      content.stories[command.storyId].steps,
      state.storyCheckpoint,
    )
  ) {
    return reject(
      "STORY_INPUT_REQUIRED",
      "Complete the required story input before finishing this story.",
    );
  }
  return accept(finishCurrentStory(state, command.storyId), content);
};

export const transition: Transition = (state, command, content, context) => {
  const invariantResult = checkGameStateInvariants(state, content);
  if (!invariantResult.ok) {
    return reject(
      "CONTENT_INVALID",
      `Cannot transition an invalid game state (${describeInvariantIssue(invariantResult.issues[0])}).`,
    );
  }

  switch (command.type) {
    case "submitStoryInput": {
      const result = submitStoryInput(state, command, content);
      return result.ok ? accept(result.nextState, content, result.feedback) : result;
    }
    case "startCase":
      return startCase(state, command, content);
    case "chooseOption":
      return chooseOption(state, command, content, context);
    case "completeStory":
      return completeStory(state, command, content);
  }
};
