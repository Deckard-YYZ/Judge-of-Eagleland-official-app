/** UI reads diagnostics through composition, never through native/file APIs. */
export interface DiagnosticViewerService {
  snapshot(): Promise<Record<string, unknown>>;
  exportReport(): Promise<string>;
  setDetailed(enabled: boolean): Promise<void>;
}
