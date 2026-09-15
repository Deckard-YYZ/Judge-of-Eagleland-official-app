import type { GameCaseDefinition, GameContentCatalog } from "./schema";

export type CaseGraphValidationIssueCode =
  "CASE_NODE_UNREACHABLE" | "CASE_GRAPH_CYCLE" | "CASE_PATH_NON_TERMINATING";

export interface CaseGraphValidationIssue {
  readonly code: CaseGraphValidationIssueCode;
  readonly objectId: string;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

const enum VisitState {
  Visiting,
  Visited,
}

interface DfsFrame {
  readonly nodeId: string;
  nextChoiceIndex: number;
}

const compareIds = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sortedNodeIds = (definition: GameCaseDefinition): string[] =>
  Object.keys(definition.nodes).sort(compareIds);

const hasMissingNodeReference = (definition: GameCaseDefinition): boolean => {
  for (const nodeId of Object.keys(definition.nodes)) {
    for (const choice of definition.nodes[nodeId].choices) {
      if (choice.target.type === "node" && !Object.hasOwn(definition.nodes, choice.target.nodeId)) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Missing node references are deliberately ignored here. C1 owns that diagnostic, and an
 * incomplete edge cannot safely prove either reachability or termination.
 */
const reachableNodeIds = (definition: GameCaseDefinition): ReadonlySet<string> => {
  if (!Object.hasOwn(definition.nodes, definition.startNodeId)) {
    return new Set();
  }

  const reachable = new Set<string>();
  const pending = [definition.startNodeId];

  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (nodeId === undefined || reachable.has(nodeId)) {
      continue;
    }

    reachable.add(nodeId);
    for (const choice of definition.nodes[nodeId].choices) {
      if (
        choice.target.type === "node" &&
        Object.hasOwn(definition.nodes, choice.target.nodeId) &&
        !reachable.has(choice.target.nodeId)
      ) {
        pending.push(choice.target.nodeId);
      }
    }
  }

  return reachable;
};

const graphIssuesForCase = (
  caseId: string,
  definition: GameCaseDefinition,
): readonly CaseGraphValidationIssue[] => {
  const issues: CaseGraphValidationIssue[] = [];
  const nodeIds = sortedNodeIds(definition);
  const reachable = reachableNodeIds(definition);

  // A missing start/edge already has a precise C1 reference issue. Until that edge is fixed,
  // derived unreachability is uncertain and would only create a cascade of secondary errors.
  if (
    Object.hasOwn(definition.nodes, definition.startNodeId) &&
    !hasMissingNodeReference(definition)
  ) {
    for (const nodeId of nodeIds) {
      if (!reachable.has(nodeId)) {
        issues.push({
          code: "CASE_NODE_UNREACHABLE",
          objectId: caseId,
          path: ["cases", caseId, "nodes", nodeId],
          message: `Node "${nodeId}" in case "${caseId}" is not reachable from start node "${definition.startNodeId}".`,
        });
      }
    }
  }

  const state = new Map<string, VisitState>();

  // Iterative three-color DFS avoids recursion limits. Only an edge to a gray (Visiting)
  // node is a cycle; an edge to black (Visited) is a legal diamond/converging branch.
  for (const rootNodeId of nodeIds) {
    if (state.has(rootNodeId)) {
      continue;
    }

    state.set(rootNodeId, VisitState.Visiting);
    const stack: DfsFrame[] = [{ nodeId: rootNodeId, nextChoiceIndex: 0 }];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const choices = definition.nodes[frame.nodeId].choices;
      if (frame.nextChoiceIndex >= choices.length) {
        state.set(frame.nodeId, VisitState.Visited);
        stack.pop();
        continue;
      }

      const choiceIndex = frame.nextChoiceIndex;
      frame.nextChoiceIndex += 1;
      const choice = choices[choiceIndex];
      if (choice.target.type !== "node" || !Object.hasOwn(definition.nodes, choice.target.nodeId)) {
        continue;
      }

      const targetNodeId = choice.target.nodeId;
      const targetState = state.get(targetNodeId);
      if (targetState === undefined) {
        state.set(targetNodeId, VisitState.Visiting);
        stack.push({ nodeId: targetNodeId, nextChoiceIndex: 0 });
        continue;
      }
      if (targetState === VisitState.Visited) {
        continue;
      }

      const path = [
        "cases",
        caseId,
        "nodes",
        frame.nodeId,
        "choices",
        choiceIndex,
        "target",
        "nodeId",
      ] as const;
      issues.push({
        code: "CASE_GRAPH_CYCLE",
        objectId: caseId,
        path,
        message: `Choice "${choice.id}" creates a directed cycle from node "${frame.nodeId}" to active node "${targetNodeId}" in case "${caseId}".`,
      });

      if (reachable.has(frame.nodeId)) {
        issues.push({
          code: "CASE_PATH_NON_TERMINATING",
          objectId: caseId,
          path,
          message: `A selectable path from start node "${definition.startNodeId}" can repeat this cycle indefinitely instead of reaching a resolution.`,
        });
      }
    }
  }

  return issues;
};

/** Pure graph validation over already structurally parsed content. */
export const collectCaseGraphIssues = (
  content: Readonly<GameContentCatalog>,
): readonly CaseGraphValidationIssue[] => {
  const issues: CaseGraphValidationIssue[] = [];
  for (const caseId of Object.keys(content.cases).sort(compareIds)) {
    issues.push(...graphIssuesForCase(caseId, content.cases[caseId]));
  }
  return issues;
};
