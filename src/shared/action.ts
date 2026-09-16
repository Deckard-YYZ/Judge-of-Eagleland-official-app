/** Stable supported game actions; localized aliases belong to the input boundary. */
export const ACTION_IDS = ["salute", "wave"] as const;
export type ActionId = (typeof ACTION_IDS)[number];
export const isActionId = (value: unknown): value is ActionId =>
  typeof value === "string" && ACTION_IDS.some((id) => id === value);
