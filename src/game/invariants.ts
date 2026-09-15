import type { CaseDefinition, ContentCatalog } from "../content/schema";
import { GameStateSchema, type GameState } from "./model";

export type GameStateInvariantIssueCode =
  | "STATE_SHAPE_INVALID"
  | "ATTRIBUTE_SET_INVALID"
  | "ATTRIBUTE_OUT_OF_RANGE"
  | "FLAG_SET_INVALID"
  | "CASE_REFERENCE_INVALID"
  | "CASE_PATH_INVALID"
  | "RESOLUTION_REFERENCE_INVALID"
  | "RESOLUTION_SNAPSHOT_INVALID"
  | "RESOLVED_ORDER_INVALID"
  | "STORY_REFERENCE_INVALID"
  | "STORY_QUEUE_INVALID"
  | "ENDING_REFERENCE_INVALID"
  | "PHASE_STORY_INVALID";

export interface GameStateInvariantIssue {
  readonly code: GameStateInvariantIssueCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export type GameStateInvariantResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly GameStateInvariantIssue[] };

type IssueCollector = (
  code: GameStateInvariantIssueCode,
  path: readonly (string | number)[],
  message: string,
) => void;

const sameMembers = (left: readonly string[], right: readonly string[]): boolean => {
  const rightMembers = new Set(right);
  return left.length === right.length && left.every((member) => rightMembers.has(member));
};

const findChoice = (definition: CaseDefinition, nodeId: string, choiceId: string) =>
  definition.nodes[nodeId]?.choices.find((choice) => choice.id === choiceId);

const checkCaseHistory = (
  caseId: string,
  definition: CaseDefinition,
  progress: Extract<GameState["cases"][string], { status: "active" } | { status: "resolved" }>,
  addIssue: IssueCollector,
): void => {
  const basePath = ["cases", caseId] as const;

  let expectedNodeId = definition.startNodeId;

  if (progress.status === "resolved" && progress.history.length === 0) {
    addIssue(
      "CASE_PATH_INVALID",
      [...basePath, "history"],
      `Resolved case "${caseId}" must retain the final choice in its history.`,
    );
  }

  progress.history.forEach((record, index) => {
    const recordPath = [...basePath, "history", index] as const;
    const node = definition.nodes[record.nodeId];

    if (!node) {
      addIssue(
        "CASE_REFERENCE_INVALID",
        [...recordPath, "nodeId"],
        `History for case "${caseId}" references unknown node "${record.nodeId}".`,
      );
      return;
    }

    if (record.nodeId !== expectedNodeId) {
      addIssue(
        "CASE_PATH_INVALID",
        [...recordPath, "nodeId"],
        `History for case "${caseId}" expected node "${expectedNodeId}" but found "${record.nodeId}".`,
      );
    }

    const choice = findChoice(definition, record.nodeId, record.choiceId);
    if (!choice) {
      addIssue(
        "CASE_REFERENCE_INVALID",
        [...recordPath, "choiceId"],
        `History for case "${caseId}" references unknown choice "${record.choiceId}" on node "${record.nodeId}".`,
      );
      return;
    }

    const isFinalRecord = index === progress.history.length - 1;
    if (choice.target.type === "node") {
      if (progress.status === "resolved" && isFinalRecord) {
        addIssue(
          "CASE_PATH_INVALID",
          recordPath,
          `Final history choice for resolved case "${caseId}" does not select a resolution.`,
        );
      }
      expectedNodeId = choice.target.nodeId;
      return;
    }

    if (
      progress.status === "active" ||
      !isFinalRecord ||
      choice.target.resolutionId !== progress.resolutionId
    ) {
      addIssue(
        "CASE_PATH_INVALID",
        recordPath,
        progress.status === "resolved"
          ? `Final history choice for case "${caseId}" does not select resolution "${progress.resolutionId}".`
          : `Active case "${caseId}" has already selected a resolution in its history.`,
      );
    }
  });

  if (progress.status === "active") {
    if (!definition.nodes[progress.currentNodeId]) {
      addIssue(
        "CASE_REFERENCE_INVALID",
        [...basePath, "currentNodeId"],
        `Active case "${caseId}" references unknown node "${progress.currentNodeId}".`,
      );
    }
    if (progress.currentNodeId !== expectedNodeId) {
      addIssue(
        "CASE_PATH_INVALID",
        [...basePath, "currentNodeId"],
        `Active case "${caseId}" should be at node "${expectedNodeId}" after its recorded history.`,
      );
    }
  }
};

const checkResolutionSnapshot = (
  caseId: string,
  definition: CaseDefinition,
  progress: Extract<GameState["cases"][string], { status: "resolved" }>,
  content: Readonly<ContentCatalog>,
  addIssue: IssueCollector,
): void => {
  const basePath = ["cases", caseId] as const;
  const resolution = definition.resolutions[progress.resolutionId];

  if (!resolution) {
    addIssue(
      "RESOLUTION_REFERENCE_INVALID",
      [...basePath, "resolutionId"],
      `Resolved case "${caseId}" references unknown resolution "${progress.resolutionId}".`,
    );
    return;
  }

  const expectedAttributeIds = Object.keys(resolution.effects.attributeDeltas);
  const snapshotAttributeIds = progress.snapshot.attributeChanges.map(
    (change) => change.attributeId,
  );
  if (
    new Set(snapshotAttributeIds).size !== snapshotAttributeIds.length ||
    !sameMembers(snapshotAttributeIds, expectedAttributeIds)
  ) {
    addIssue(
      "RESOLUTION_SNAPSHOT_INVALID",
      [...basePath, "snapshot", "attributeChanges"],
      `Snapshot attributes for case "${caseId}" must match the selected resolution effects exactly.`,
    );
  }

  progress.snapshot.attributeChanges.forEach((change, index) => {
    const changePath = [...basePath, "snapshot", "attributeChanges", index] as const;
    const attribute = content.attributes[change.attributeId];
    const authoredDelta = resolution.effects.attributeDeltas[change.attributeId];

    if (!attribute || authoredDelta === undefined) {
      addIssue(
        "RESOLUTION_SNAPSHOT_INVALID",
        [...changePath, "attributeId"],
        `Snapshot for case "${caseId}" references attribute "${change.attributeId}" outside the selected resolution.`,
      );
      return;
    }

    const expectedAfter = Math.min(
      attribute.max,
      Math.max(attribute.min, change.before + authoredDelta),
    );
    if (
      change.before < attribute.min ||
      change.before > attribute.max ||
      change.after !== expectedAfter ||
      change.actualDelta !== change.after - change.before
    ) {
      addIssue(
        "RESOLUTION_SNAPSHOT_INVALID",
        changePath,
        `Snapshot change for attribute "${change.attributeId}" is inconsistent with its range and authored delta.`,
      );
    }
  });
};

/**
 * Checks the state facts that can be proven from a GameState plus its bound catalog.
 * S1 is encoded by the cases record; S2/S4-S6 are checked here. S3/S7/S8 are command
 * preconditions for transition, not static state facts. S9/S10 belong to atomic storage
 * publication and revision control, so a pure state validator must not claim to enforce them.
 */
export const checkGameStateInvariants = (
  candidate: unknown,
  content: Readonly<ContentCatalog>,
): GameStateInvariantResult => {
  const parsed = GameStateSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code:
          issue.code === "custom" &&
          (issue.path[0] === "pendingStoryIds" || issue.path[0] === "completedStoryIds")
            ? "STORY_QUEUE_INVALID"
            : "STATE_SHAPE_INVALID",
        path: issue.path.map((segment) =>
          typeof segment === "symbol" ? (segment.description ?? String(segment)) : segment,
        ),
        message: issue.message,
      })),
    };
  }

  const state = parsed.data;
  const issues: GameStateInvariantIssue[] = [];
  const addIssue: IssueCollector = (code, path, message) => {
    issues.push({ code, path, message });
  };

  const stateAttributeIds = Object.keys(state.attributes);
  const contentAttributeIds = Object.keys(content.attributes);
  if (!sameMembers(stateAttributeIds, contentAttributeIds)) {
    addIssue(
      "ATTRIBUTE_SET_INVALID",
      ["attributes"],
      "State attributes must contain every declared attribute and no unknown attributes.",
    );
  }

  for (const [attributeId, value] of Object.entries(state.attributes)) {
    const definition = content.attributes[attributeId];
    if (definition && (value < definition.min || value > definition.max)) {
      addIssue(
        "ATTRIBUTE_OUT_OF_RANGE",
        ["attributes", attributeId],
        `Attribute "${attributeId}" value ${value} is outside [${definition.min}, ${definition.max}].`,
      );
    }
  }

  if (!sameMembers(Object.keys(state.flags), Object.keys(content.initial.flags))) {
    addIssue(
      "FLAG_SET_INVALID",
      ["flags"],
      "State flags must contain every declared flag and no unknown flags.",
    );
  }

  const resolvedOrders: number[] = [];
  for (const [caseId, progress] of Object.entries(state.cases)) {
    const definition = content.cases[caseId];
    if (!definition) {
      addIssue(
        "CASE_REFERENCE_INVALID",
        ["cases", caseId],
        `State references unknown case "${caseId}".`,
      );
      continue;
    }

    if (progress.status === "active") {
      checkCaseHistory(caseId, definition, progress, addIssue);
    } else if (progress.status === "resolved") {
      checkCaseHistory(caseId, definition, progress, addIssue);
      checkResolutionSnapshot(caseId, definition, progress, content, addIssue);
      resolvedOrders.push(progress.snapshot.resolvedOrder);
    }
  }

  const orderedResolvedOrders = [...resolvedOrders].sort((left, right) => left - right);
  if (orderedResolvedOrders.some((order, index) => order !== index + 1)) {
    addIssue(
      "RESOLVED_ORDER_INVALID",
      ["cases"],
      "Resolved case order values must be unique and contiguous from 1.",
    );
  }

  for (const [collection, storyIds] of [
    ["pendingStoryIds", state.pendingStoryIds],
    ["completedStoryIds", state.completedStoryIds],
  ] as const) {
    storyIds.forEach((storyId, index) => {
      if (!content.stories[storyId]) {
        addIssue(
          "STORY_REFERENCE_INVALID",
          [collection, index],
          `${collection} references unknown story "${storyId}".`,
        );
      }
    });
  }

  const endingStoryIds = new Set(Object.values(content.endings).map((ending) => ending.storyId));
  const reportUnexpectedEndingStories = (
    collection: "pendingStoryIds" | "completedStoryIds",
    allowedStoryId?: string,
  ): void => {
    state[collection].forEach((storyId, index) => {
      if (endingStoryIds.has(storyId) && storyId !== allowedStoryId) {
        addIssue(
          "PHASE_STORY_INVALID",
          [collection, index],
          `Story "${storyId}" is an ending story that does not belong in the ${state.phase.type} phase.`,
        );
      }
    });
  };

  if (state.phase.type === "playing") {
    reportUnexpectedEndingStories("pendingStoryIds");
    reportUnexpectedEndingStories("completedStoryIds");
  } else {
    const ending = content.endings[state.phase.endingId];
    if (!ending) {
      addIssue(
        "ENDING_REFERENCE_INVALID",
        ["phase", "endingId"],
        `Phase references unknown ending "${state.phase.endingId}".`,
      );
    } else if (!content.stories[ending.storyId]) {
      addIssue(
        "ENDING_REFERENCE_INVALID",
        ["phase", "endingId"],
        `Ending "${state.phase.endingId}" references unknown story "${ending.storyId}".`,
      );
    } else if (state.phase.type === "ending") {
      reportUnexpectedEndingStories("pendingStoryIds", ending.storyId);
      reportUnexpectedEndingStories("completedStoryIds", ending.storyId);
      if (state.pendingStoryIds.at(-1) !== ending.storyId) {
        addIssue(
          "PHASE_STORY_INVALID",
          ["pendingStoryIds"],
          `Ending story "${ending.storyId}" must be the final pending story while ending.`,
        );
      }
    } else {
      reportUnexpectedEndingStories("pendingStoryIds", ending.storyId);
      reportUnexpectedEndingStories("completedStoryIds", ending.storyId);
      if (state.pendingStoryIds.length > 0) {
        addIssue(
          "PHASE_STORY_INVALID",
          ["pendingStoryIds"],
          "An ended run cannot retain pending stories.",
        );
      }
      if (!state.completedStoryIds.includes(ending.storyId)) {
        addIssue(
          "PHASE_STORY_INVALID",
          ["completedStoryIds"],
          `Ended run must retain completed ending story "${ending.storyId}".`,
        );
      }
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
};
