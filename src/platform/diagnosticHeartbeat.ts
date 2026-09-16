import { invoke } from "@tauri-apps/api/core";

/** One outstanding IPC at most. A timeout cannot cancel IPC, so stop this run. */
export function startDiagnosticHeartbeat(
  send: (visible: boolean) => Promise<unknown> = (visible) =>
    invoke("diagnostics_heartbeat", { visible }),
  visibility: () => boolean = () => document.visibilityState === "visible",
  intervalMs = 2000,
  timeoutMs = 5000,
) {
  let stopped = false;
  let pending = false;
  let degraded = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const pulse = (): void => {
    if (stopped || pending) return;
    pending = true;
    deadline = setTimeout(() => {
      degraded = true;
      stop();
    }, timeoutMs);
    // Promise.resolve also isolates a synchronously throwing transport.
    void Promise.resolve()
      .then(() => send(visibility()))
      .catch(() => {
        degraded = true;
        stop();
      })
      .finally(() => {
        pending = false;
        clearTimeout(deadline);
      });
  };
  const timer = setInterval(pulse, intervalMs);
  const changed = () => pulse();
  function stop(): void {
    stopped = true;
    clearInterval(timer);
    clearTimeout(deadline);
    document.removeEventListener("visibilitychange", changed);
  }
  document.addEventListener("visibilitychange", changed);
  pulse();
  return { stop, status: () => ({ stopped, pending, degraded }) };
}
