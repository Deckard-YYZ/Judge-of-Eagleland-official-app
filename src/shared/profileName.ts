/** Normalize displayed local names consistently in forms and persistence. */
export const normalizeProfileDisplayName = (value: string): string =>
  value.trim().replace(/\s+/gu, " ");
