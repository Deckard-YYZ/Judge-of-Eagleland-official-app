import { Component, type ErrorInfo, type ReactNode } from "react";
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
    return (
      <main className="startup-screen">
        <section className="startup-screen__panel" role="alert">
          <h1>界面发生错误 / Interface error</h1>
          <p>请重新加载并读取已保存进度。正在提交的操作需要重新读档核对，不会自动重试。</p>
          <button
            type="button"
            className="button button--primary"
            onClick={() => window.location.reload()}
          >
            重新加载 / Reload
          </button>
          {this.props.onDiagnostics ? (
            <button type="button" className="button" onClick={this.props.onDiagnostics}>
              诊断信息 / Diagnostics
            </button>
          ) : null}
        </section>
      </main>
    );
  }
}
