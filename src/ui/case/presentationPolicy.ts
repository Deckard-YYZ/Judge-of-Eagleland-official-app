/** Session-only presentation facts; never authoritative game data. */
export type PresentationMode = "normal" | "immediate";
let nextPresentationScope = 0;
export interface DecisionPresentationHistory {
  readonly scopeId: number;
  has(identity: string): boolean;
  mark(identity: string): void;
}
export const createDecisionPresentationHistory = (): DecisionPresentationHistory => {
  const shown = new Set<string>();
  return {
    scopeId: ++nextPresentationScope,
    has: (identity) => shown.has(identity),
    mark: (identity) => {
      shown.add(identity);
    },
  };
};
export const decisionPresentationIdentity = (
  packageId: string,
  version: string,
  caseId: string,
  nodeId: string,
): string => JSON.stringify([packageId, version, caseId, nodeId]);
