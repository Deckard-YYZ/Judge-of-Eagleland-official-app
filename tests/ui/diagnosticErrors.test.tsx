// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { configureDiagnostics, type DiagnosticEvent } from "../../src/shared/diagnostics";
import { installGlobalErrorLogging } from "../../src/platform/globalErrors";
import { DiagnosticErrorBoundary } from "../../src/app/DiagnosticErrorBoundary";

afterEach(() => {
  cleanup();
  configureDiagnostics(() => undefined);
  vi.restoreAllMocks();
});

it("observes global errors and rejection without suppressing browser reporting", () => {
  const events: DiagnosticEvent[] = [];
  configureDiagnostics((event) => events.push(event));
  const dispose = installGlobalErrorLogging();
  const error = new Error("root cause");
  const event = new ErrorEvent("error", { error, cancelable: true });
  window.dispatchEvent(event);
  const rejection = new Event("unhandledrejection", { cancelable: true });
  Object.defineProperty(rejection, "reason", { value: error });
  window.dispatchEvent(rejection);
  expect(events.map((entry) => entry.event)).toEqual([
    "frontend.uncaught_error",
    "frontend.unhandled_rejection",
  ]);
  expect(events.every((entry) => entry.error === error)).toBe(true);
  expect(event.defaultPrevented || rejection.defaultPrevented).toBe(false);
  dispose();
});

it("renders explicit reload recovery and records React failure without claiming rollback", () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const events: DiagnosticEvent[] = [];
  configureDiagnostics((event) => events.push(event));
  function Broken(): never {
    throw new Error("render failed");
  }
  render(
    <DiagnosticErrorBoundary>
      <Broken />
    </DiagnosticErrorBoundary>,
  );
  expect(screen.getByRole("button", { name: /重新加载/ })).toBeTruthy();
  expect(screen.getByText(/不会自动重试/)).toBeTruthy();
  expect(events.some((event) => event.event === "react.render_failed")).toBe(true);
});
