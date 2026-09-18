import { getDiagnostics, type DiagnosticContext } from "../shared/diagnostics";
import { readBundledContentPackage, type BundledPackageReader } from "../platform/contentResources";
import { loadSplitContentPackage } from "./localizedPackageFormat";
import { ContentRepositoryError, type SplitContentRepository } from "./repository";
import { ContentRefSchema, type ContentLocale, type ContentRef } from "./schema";

/** Exact installed package used for new desktop saves; old saves retain their own ref. */
export const DEFAULT_BUNDLED_CONTENT_REF: Readonly<ContentRef> = Object.freeze({
  packageId: "minimal-test-package",
  version: "1.2.0",
});

/** Read and validate the whole immutable package before exposing either catalog. */
export class BundledSplitContentRepository implements SplitContentRepository {
  constructor(private readonly readPackage: BundledPackageReader = readBundledContentPackage) {}

  private async loadPackage(ref: ContentRef, supplied?: DiagnosticContext) {
    const context = supplied ?? { operationId: getDiagnostics().operationId() };
    const parsed = ContentRefSchema.safeParse(ref);
    if (!parsed.success) {
      getDiagnostics().record({
        source: "content",
        event: "content.ref.rejected",
        level: "warn",
        ...context,
        data: { code: "INVALID_REF" },
      });
      throw new ContentRepositoryError(
        "INVALID_REF",
        "Invalid bundled content reference.",
        parsed.error,
      );
    }
    const data = { contentPackageId: parsed.data.packageId, contentVersion: parsed.data.version };
    getDiagnostics().record({ source: "content", event: "content.load.started", ...context, data });
    let files;
    try {
      files = await this.readPackage(parsed.data);
    } catch (error) {
      getDiagnostics().record({
        source: "content",
        event: "content.read.failed",
        level: "error",
        ...context,
        data,
        error,
      });
      // Never substitute a fixture or another version when a bundled read fails.
      throw new ContentRepositoryError(
        "CONTENT_NOT_FOUND",
        `Cannot read bundled content ${parsed.data.packageId}@${parsed.data.version}.`,
        error,
      );
    }
    const result = loadSplitContentPackage(files.sources, {
      fileInventory: files.fileInventory,
      expectedPackageId: parsed.data.packageId,
      expectedVersion: parsed.data.version,
    });
    if (!result.ok) {
      getDiagnostics().record({
        source: "content",
        event: "content.validation.failed",
        level: "error",
        ...context,
        data: {
          ...data,
          issueCount: result.issues.length,
          issues: result.issues
            .slice(0, 16)
            .map((issue) => ({ code: issue.code, path: issue.path, source: issue.source })),
        },
      });
      throw new ContentRepositoryError(
        "INVALID_CONTENT",
        "The bundled content package is invalid.",
        result.issues,
      );
    }
    getDiagnostics().record({
      source: "content",
      event: "content.load.succeeded",
      ...context,
      data,
    });
    return result;
  }

  async loadGameContent(ref: ContentRef, context?: DiagnosticContext) {
    return (await this.loadPackage(ref, context)).gameContent;
  }

  async loadLocalization(ref: ContentRef, locale: ContentLocale) {
    const result = await this.loadPackage(ref);
    const localization = result.localizations[locale];
    if (!localization) {
      throw new ContentRepositoryError(
        "LOCALIZATION_NOT_FOUND",
        `Bundled localization ${locale} is unavailable.`,
      );
    }
    return localization;
  }
}
