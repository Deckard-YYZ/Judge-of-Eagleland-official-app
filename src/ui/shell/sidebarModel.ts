import {
  selectPendingAndActiveCases,
  selectResolvedCases,
} from "../../application/gameSessionViewSelectors";
import type { GameSessionViewSnapshot } from "../../application/gameSessionView";

export interface SidebarAttributeItem {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
}

export type SidebarPendingCaseItem = ReturnType<typeof selectPendingAndActiveCases>[number];
export type SidebarResolvedCaseItem = ReturnType<typeof selectResolvedCases>[number];

export interface SidebarModel {
  readonly attributes: readonly SidebarAttributeItem[];
  readonly pendingCases: readonly SidebarPendingCaseItem[];
  readonly resolvedCases: readonly SidebarResolvedCaseItem[];
}

const EMPTY_SIDEBAR_MODEL: SidebarModel = Object.freeze({
  attributes: Object.freeze([]),
  pendingCases: Object.freeze([]),
  resolvedCases: Object.freeze([]),
});

/**
 * Builds display-only sidebar data from one committed session snapshot. The UI
 * never maintains parallel case lists or derives consequences from content effects.
 */
export function createSidebarModel(snapshot: GameSessionViewSnapshot): SidebarModel {
  if (!snapshot.state || !snapshot.content) {
    return EMPTY_SIDEBAR_MODEL;
  }

  const attributes = Object.entries(snapshot.content.attributes).flatMap(
    ([attributeId, definition]) => {
      const value = snapshot.state?.attributes[attributeId];
      return value === undefined
        ? []
        : [
            {
              id: attributeId,
              label: definition.label,
              value,
              min: definition.min,
              max: definition.max,
            },
          ];
    },
  );

  return {
    attributes,
    // These selectors are the single source of truth for membership and ordering.
    pendingCases: selectPendingAndActiveCases(snapshot.state, snapshot.content),
    resolvedCases: selectResolvedCases(snapshot.state, snapshot.content),
  };
}
