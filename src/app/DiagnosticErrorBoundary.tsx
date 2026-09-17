import { Component, type ErrorInfo, type ReactNode } from "react";
import { useDocumentTranslator } from "../ui/i18n/useDocumentTranslator";
import { getDiagnostics } from "../shared/diagnostics";

/** A rendering failure never means an in-flight save was rolled back. */
export class DiagnosticErrorBoundary extends Component<
  { children: ReactNode; onDiagnostics?: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    getDiagnostics().record({
      source: "ui",
      event: "react.render_failed",
      level: "error",
      error,
      data: { componentStack: info.componentStack },
    });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <DiagnosticFallback onDiagnostics={this.props.onDiagnostics} />;
  }
}

function DiagnosticFallback({ onDiagnostics }: { onDiagnostics?: () => void }) {
  const t = useDocumentTranslator();
  return (
    <main className="startup-screen">
      <section className="startup-screen__panel" role="alert">
        <h1>{t("diagnostics.interfaceError")}</h1>
        <p>{t("diagnostics.reloadNotice")}</p>
        <button
          type="button"
          className="button button--primary"
          onClick={() => window.location.reload()}
        >
          {t("diagnostics.reload")}
        </button>
        {onDiagnostics ? (
          <button type="button" className="button" onClick={onDiagnostics}>
            {t("diagnostics.title")}
          </button>
        ) : null}
      </section>
    </main>
  );
}
