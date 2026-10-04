import {
  CaseEventSchema,
  FlowFactsSchema,
  type FlowFacts,
  type GameContentCatalog,
} from "../content/schema";
import { validateGameContentCatalog } from "../content/validate";
import type { GameState } from "../game/model";
import { GameStateSchema } from "../game/model";
import { checkGameStateInvariants } from "../game/invariants";
import * as computation from "../game/flowQueries";
import type { ProgressionResult } from "../game/progression";
import { caseEventId } from "../game/configuration";

export type {
  ConditionExplanation,
  StageTransitionQuery,
  ChatAvailability,
  ChatNodeQuery,
  ConsequenceEligibility,
} from "../game/flowQueries";

/** Public query boundary: reject unvalidated catalogs, state and foreign facts before computing. */
function withInputs<T>(
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
  input: unknown,
  compute: (facts: Readonly<FlowFacts>) => ProgressionResult<T>,
): ProgressionResult<T> {
  const catalog = validateGameContentCatalog(content);
  if (!catalog.ok)
    return {
      ok: false,
      issues: catalog.issues.map(({ path, message }) => ({
        code: "CONFIGURATION_INVALID",
        path,
        message,
      })),
    };
  const parsedState = GameStateSchema.safeParse(state);
  if (!parsedState.success)
    return {
      ok: false,
      issues: [
        {
          code: "CONFIGURATION_INVALID",
          path: ["state"],
          message: "Query state must match the strict game-state contract.",
        },
      ],
    };
  const invariants = checkGameStateInvariants(parsedState.data, catalog.catalog);
  if (!invariants.ok)
    return {
      ok: false,
      issues: invariants.issues.map(({ path, message }) => ({
        code: "CONFIGURATION_INVALID",
        path,
        message,
      })),
    };
  const facts = FlowFactsSchema.safeParse(input);
  if (!facts.success)
    return {
      ok: false,
      issues: [
        {
          code: "CONFIGURATION_INVALID",
          path: ["facts"],
          message: "Flow facts must match the strict facts contract.",
        },
      ],
    };
  return compute(facts.data);
}

export function queryStageTransitions(
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
  facts: unknown,
) {
  return withInputs(state, content, facts, (validated) =>
    computation.computeStageTransitions(state, content, validated),
  );
}
export function queryChatAvailability(
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
  facts: unknown,
) {
  return withInputs(state, content, facts, (validated) =>
    computation.computeChatAvailability(state, content, validated),
  );
}
export function queryChatNode(
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
  facts: unknown,
  chatId: string,
  nodeId: string,
) {
  return withInputs(state, content, facts, (validated) =>
    computation.computeChatNode(state, content, validated, chatId, nodeId),
  );
}
export function queryFlowEvent(
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
  facts: unknown,
  eventId: string,
) {
  return withInputs(state, content, facts, (validated) =>
    computation.computeFlowEvent(state, content, validated, eventId),
  );
}
export function queryCaseCharacters(content: Readonly<GameContentCatalog>, caseId: string) {
  const catalog = validateGameContentCatalog(content);
  if (!catalog.ok)
    return {
      ok: false as const,
      issues: catalog.issues.map(({ path, message }) => ({
        code: "CONFIGURATION_INVALID" as const,
        path,
        message,
      })),
    };
  return computation.computeCaseCharacters(catalog.catalog, caseId);
}

export function queryChatExternalEvent(
  state: Readonly<GameState>,
  content: Readonly<GameContentCatalog>,
  facts: unknown,
  chatId: string,
  nodeId: string,
  event: unknown,
): ProgressionResult<computation.ChatExternalQuery> {
  return withInputs(state, content, facts, (validated) => {
    const parsed = CaseEventSchema.safeParse(event);
    if (
      !parsed.success ||
      !state.configurationFacts?.some((fact) => fact.eventId === caseEventId(parsed.data))
    )
      return {
        ok: false,
        issues: [
          {
            code: "CONFIGURATION_INVALID",
            path: ["event"],
            message: "External branch queries require an actual committed case event.",
          },
        ],
      };
    return computation.computeChatExternalEvent(
      state,
      content,
      validated,
      chatId,
      nodeId,
      parsed.data,
    );
  });
}
