import type { GameContentCatalog, GameEffects } from "../content/schema";
import type { AttributeChangeSnapshot, GameState } from "./model";

export interface GameEffectIssue {
  readonly code: "ATTRIBUTE_REFERENCE_INVALID" | "FLAG_REFERENCE_INVALID";
  readonly path: readonly (string | number)[];
  readonly message: string;
}
export type GameEffectsResult =
  | {
      readonly ok: true;
      readonly attributes: GameState["attributes"];
      readonly flags: GameState["flags"];
      readonly changes: AttributeChangeSnapshot[];
    }
  | { readonly ok: false; readonly issues: readonly GameEffectIssue[] };
const compareIds = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** Applies only attribute/flag facts, with deterministic ordering and actual clamped deltas.
 * It intentionally does not unlock cases, schedule stories, or reselect a locked ending.
 */
export function applyGameEffects(
  state: Readonly<GameState>,
  effects: Readonly<GameEffects>,
  content: Readonly<GameContentCatalog>,
  path: readonly (string | number)[] = [],
): GameEffectsResult {
  const attributeIds = Object.keys(effects.attributeDeltas).sort(compareIds);
  const flagIds = Object.keys(effects.setFlags).sort(compareIds);
  const referenceIssues: GameEffectIssue[] = [];

  for (const attributeId of attributeIds) {
    if (!content.attributes[attributeId] || !Object.hasOwn(state.attributes, attributeId)) {
      referenceIssues.push({
        code: "ATTRIBUTE_REFERENCE_INVALID",
        path: [...path, "attributeDeltas", attributeId],
        message: `Game effects references unavailable attribute "${attributeId}".`,
      });
    }
  }
  for (const flagId of flagIds) {
    if (!Object.hasOwn(content.initial.flags, flagId) || !Object.hasOwn(state.flags, flagId)) {
      referenceIssues.push({
        code: "FLAG_REFERENCE_INVALID",
        path: [...path, "setFlags", flagId],
        message: `Game effects references unavailable flag "${flagId}".`,
      });
    }
  }
  if (referenceIssues.length > 0) {
    return { ok: false, issues: referenceIssues };
  }

  const attributes = { ...state.attributes };
  const changes: AttributeChangeSnapshot[] = attributeIds.map((attributeId) => {
    const attribute = content.attributes[attributeId];
    const before = state.attributes[attributeId];
    const requestedDelta = effects.attributeDeltas[attributeId];
    const after = Math.min(attribute.max, Math.max(attribute.min, before + requestedDelta));
    attributes[attributeId] = after;
    return {
      attributeId,
      before,
      after,
      actualDelta: after - before,
    };
  });

  const flags = { ...state.flags };
  for (const flagId of flagIds) {
    flags[flagId] = effects.setFlags[flagId];
  }

  return { ok: true, attributes, flags, changes };
}
