/**
 * UI-facing read facade for domain selectors. React imports this Application
 * surface instead of reaching through the session wall into the game layer.
 */
export {
  selectPendingAndActiveCases,
  selectResolvedCases,
  type CaseListItem,
  type PendingOrActiveCaseProgress,
  type ResolvedCaseProgress,
} from "../game/selectors";
