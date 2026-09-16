import { useEffect, useState } from "react";
import type { DiagnosticViewerService } from "../shared/diagnosticViewer";

/** Read-only observer: no save reads, command retries, or recovery side effects. */
export function DiagnosticsPanel({
  service,
  onClose,
}: {
  service: DiagnosticViewerService;
  onClose(): void;
}) {
  const [snapshot, setSnapshot] = useState<Record<string, unknown>>({});
  const [filter, setFilter] = useState("");
  const [level, setLevel] = useState("");
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    let live = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const value = await service.snapshot();
        if (live) setSnapshot(value);
      } catch {
        if (live) setNotice("诊断状态不可用 / Diagnostics unavailable");
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [service]);
  const host = snapshot.host as Record<string, unknown> | undefined;
  const recent = [
    ...(Array.isArray(host?.recent) ? host.recent : []),
    ...(Array.isArray(snapshot.recent) ? snapshot.recent : []),
  ] as Record<string, unknown>[];
  const records = recent.filter(
    (record) =>
      (!level || record.level === level) &&
      JSON.stringify(record).toLowerCase().includes(filter.toLowerCase()),
  );
  const summary = {
    ...snapshot,
    recent: undefined,
    host: host ? { ...host, recent: undefined } : undefined,
  };
  return (
    <section
      className="diagnostics-panel"
      role="dialog"
      aria-modal="true"
      aria-label="诊断信息 / Diagnostics"
    >
      <h2>诊断信息 / Diagnostics</h2>
      <button type="button" autoFocus onClick={onClose}>
        关闭 / Close
      </button>
      <p>
        心跳仅代表观测点响应，不代表保存成功。报告只导出本地摘要，不会上传。分享前请检查；异常文字脱敏是尽力处理。
      </p>
      <button
        type="button"
        onClick={async () => {
          try {
            await service.setDetailed(true);
            setNotice("详细日志已开启 5 分钟；到期自动恢复默认级别，不启用 dump。");
          } catch {
            setNotice("原生日志级别更新失败或结果未知；前端设置已应用。");
          }
        }}
      >
        详细日志 5 分钟 / Detailed
      </button>
      <button
        type="button"
        onClick={async () => {
          try {
            await service.setDetailed(false);
            setNotice("已恢复默认级别 / Default level restored");
          } catch {
            setNotice("原生日志级别更新失败或结果未知；前端设置已应用。");
          }
        }}
      >
        默认级别 / Default
      </button>
      <button
        type="button"
        disabled={exporting}
        onClick={async () => {
          setExporting(true);
          try {
            setNotice(`导出成功 / Exported: ${await service.exportReport()}`);
          } catch {
            setNotice(
              "导出未确认 / Export failed or timed out. 超时可能仍在写报告；游戏状态未改变。",
            );
          } finally {
            setExporting(false);
          }
        }}
      >
        导出报告 / Export report
      </button>
      <p role="status">{notice}</p>
      <pre>{JSON.stringify(summary, null, 2)}</pre>
      <label>
        筛选事件或 operation / Filter
        <input value={filter} onChange={(event) => setFilter(event.target.value)} />
      </label>
      <label>
        级别 / Level
        <select value={level} onChange={(event) => setLevel(event.target.value)}>
          <option value="">全部 / All</option>
          {["debug", "info", "warn", "error"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <p>{records.length} 条记录 / records（有界窗口，可能缺失）</p>
      <pre>{records.map((record) => JSON.stringify(record)).join("\n")}</pre>
    </section>
  );
}
