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

it("exposes the optional debug entry and exit only when supplied by the development shell", async () => {
  const service = {
    snapshot: vi.fn(async () => ({})),
    exportReport: vi.fn(async () => "report"),
    setDetailed: vi.fn(async () => undefined),
  };
  const toggle = vi.fn();
  const { rerender } = render(<DiagnosticsPanel service={service} onClose={() => undefined} />);
  expect(screen.queryByRole("button", { name: /主流程验证/ })).toBeNull();
  rerender(
    <DiagnosticsPanel
      service={service}
      onClose={() => undefined}
      mainFlowPreview={{ active: false, toggle }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /主流程验证/ }));
  expect(toggle).toHaveBeenCalledOnce();
  rerender(
    <DiagnosticsPanel
      service={service}
      onClose={() => undefined}
      mainFlowPreview={{ active: true, toggle }}
    />,
  );
  expect(screen.getByRole("button", { name: "退出主流程验证" })).toBeTruthy();
  await waitFor(() => expect(service.snapshot).toHaveBeenCalled());
});
