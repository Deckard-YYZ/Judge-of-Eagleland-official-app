// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({
  invoke: vi.fn(),
  desktop: true,
  local: { recent: [] as unknown[] },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocked.invoke, isTauri: () => mocked.desktop }));
vi.mock("../../src/platform/diagnostics", () => ({
  getDiagnosticLocalSnapshot: () => mocked.local,
  getDiagnosticTransportStatus: () => ({ dropped: 3 }),
  getDiagnosticHeartbeatStatus: () => ({ degraded: false }),
  setDiagnosticDetailed: vi.fn(),
  sanitizeDiagnostic: (value: unknown) => value,
}));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  mocked.invoke.mockReset();
  mocked.desktop = true;
  mocked.local.recent = [];
});
it("bounds stalled native requests and rejects repeated detail requests while pending", async () => {
  vi.useFakeTimers();
  mocked.invoke.mockImplementation(() => new Promise(() => undefined));
  const { diagnosticViewer } = await import("../../src/platform/diagnosticViewer");
  const pending = diagnosticViewer.snapshot();
  await vi.advanceTimersByTimeAsync(1501);
  expect((await pending).host).toEqual({ unavailable: true });
  await diagnosticViewer.snapshot();
  expect(mocked.invoke).toHaveBeenCalledTimes(1);
  const detail = diagnosticViewer.setDetailed(true).catch((error) => error);
  await expect(diagnosticViewer.setDetailed(false)).rejects.toThrow(/pending/);
  expect(mocked.invoke).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1501);
  expect(await detail).toBeInstanceOf(Error);
});
it("downloads browser report with bounded recent records and explicit omissions", async () => {
  mocked.desktop = false;
  mocked.local.recent = Array.from({ length: 256 }, () => ({
    event: "test",
    error: { message: "x".repeat(2000) },
  }));
  let payload = "";
  vi.stubGlobal(
    "Blob",
    class {
      constructor(chunks: string[]) {
        payload = chunks.join("");
      }
    },
  );
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL() {
        return "blob:test";
      }
      static revokeObjectURL() {}
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const { diagnosticViewer, boundedFrontendSummary } =
    await import("../../src/platform/diagnosticViewer");
  expect(boundedFrontendSummary().coverage.omittedRecent).toBeGreaterThan(0);
  expect(await diagnosticViewer.exportReport()).toMatch(/eagle-report-.*json/);
  const report = JSON.parse(payload);
  expect(report.protocolVersion).toBe(1);
  expect(report.frontend.coverage.omittedRecent).toBeGreaterThan(0);
  expect(report.frontend.recent.length).toBeGreaterThan(0);
  expect(mocked.invoke).not.toHaveBeenCalled();
});
