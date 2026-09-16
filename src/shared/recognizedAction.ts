import type { ActionId } from "./action";

/** Recognition is evidence only; Game Core decides whether an action is correct. */
export type RecognizedAction = { type: "known"; actionId: ActionId } | { type: "unknown" };
