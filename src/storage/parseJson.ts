/** JSON parser errors can echo input in message/stack; storage errors must not. */
export function parseStorageJson(
  value: string,
  code: "INVALID_STORED_JSON" | "INVALID_SETTING_JSON" | "INVALID_BACKUP_JSON",
): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    // Capture a fresh stack at the boundary, without retaining the original cause.
    throw Object.assign(new SyntaxError("Invalid JSON at storage boundary."), { code });
  }
}
