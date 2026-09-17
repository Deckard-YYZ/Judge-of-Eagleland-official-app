// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DiagnosticsPanel } from "../../src/ui/DiagnosticsPanel";
afterEach(cleanup);
it("filters operation evidence and exposes export failure without invoking game work", async () => {
  const service = {
    snapshot: vi.fn(async () => ({
      identity: { runId: "r" },
      transport: { unavailable: true },
      recent: [
        { event: "save.commit.started", operationId: "op-1", level: "info" },
        { event: "input.unknown", level: "warn" },
      ],
    })),
    exportReport: vi.fn(async () => {
      throw new Error("disk full");
    }),
    setDetailed: vi.fn(async () => undefined),
  };
  render(<DiagnosticsPanel service={service} onClose={() => undefined} />);
  await screen.findByText(/2 条记录/);
  fireEvent.change(screen.getByLabelText("筛选事件或操作"), {
    target: { value: "op-1" },
  });
  expect(screen.getByText(/1 条记录/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("级别"), { target: { value: "error" } });
  expect(screen.getByText(/0 条记录/)).toBeTruthy();
  fireEvent.click(screen.getByText("详细日志 5 分钟"));
  expect(service.setDetailed).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByText("导出报告"));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("导出未确认"));
});
