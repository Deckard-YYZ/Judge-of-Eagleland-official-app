import { useEffect, useState } from "react";
import { useDocumentTranslator } from "./i18n/useDocumentTranslator";
import type { DiagnosticViewerService } from "../shared/diagnosticViewer";

/** Read-only observer: no save reads, command retries, or recovery side effects. */
export function DiagnosticsPanel({
  service,
  onClose,
}: {
  service: DiagnosticViewerService;
  onClose(): void;
}) {
  const t = useDocumentTranslator();
  const [snapshot, setSnapshot] = useState<Record<string, unknown>>({});
  const [filter, setFilter] = useState("");
  const [level, setLevel] = useState("");
  const [notice, setNotice] = useState<
    | "diagnostics.unavailable"
    | "diagnostics.detailedEnabled"
    | "diagnostics.levelFailed"
    | "diagnostics.defaultRestored"
    | "diagnostics.exported"
    | "diagnostics.exportFailed"
    | ""
  >("");
  const [exportPath, setExportPath] = useState("");
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
        if (live) setNotice("diagnostics.unavailable");
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
      aria-label={t("diagnostics.title")}
    >
      <h2>{t("diagnostics.title")}</h2>
      <button type="button" autoFocus onClick={onClose}>
        {t("diagnostics.close")}
      </button>
      <p>{t("diagnostics.notice")}</p>
      <button
        type="button"
        onClick={async () => {
          try {
            await service.setDetailed(true);
            setNotice("diagnostics.detailedEnabled");
          } catch {
            setNotice("diagnostics.levelFailed");
          }
        }}
      >
        {t("diagnostics.detailed")}
      </button>
      <button
        type="button"
        onClick={async () => {
          try {
            await service.setDetailed(false);
            setNotice("diagnostics.defaultRestored");
          } catch {
            setNotice("diagnostics.levelFailed");
          }
        }}
      >
        {t("diagnostics.default")}
      </button>
      <button
        type="button"
        disabled={exporting}
        onClick={async () => {
          setExporting(true);
          try {
            setExportPath(await service.exportReport());
            setNotice("diagnostics.exported");
          } catch {
            setNotice("diagnostics.exportFailed");
          } finally {
            setExporting(false);
          }
        }}
      >
        {t("diagnostics.export")}
      </button>
      <p role="status">
        {notice === "diagnostics.exported"
          ? t(notice, { path: exportPath })
          : notice
            ? t(notice)
            : ""}
      </p>
      <pre>{JSON.stringify(summary, null, 2)}</pre>
      <label>
        {t("diagnostics.filter")}
        <input value={filter} onChange={(event) => setFilter(event.target.value)} />
      </label>
      <label>
        {t("diagnostics.level")}
        <select value={level} onChange={(event) => setLevel(event.target.value)}>
          <option value="">{t("diagnostics.all")}</option>
          {(["debug", "info", "warn", "error"] as const).map((value) => (
            <option key={value} value={value}>
              {t(`diagnostics.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <p>{t("diagnostics.records", { count: records.length })}</p>
      <pre>{records.map((record) => JSON.stringify(record)).join("\n")}</pre>
    </section>
  );
}
