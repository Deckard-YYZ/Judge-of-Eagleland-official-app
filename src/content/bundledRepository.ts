import { readBundledContentPackage, type BundledPackageReader } from "../platform/contentResources";
import { loadSplitContentPackage } from "./localizedPackageFormat";
import { ContentRepositoryError, type SplitContentRepository } from "./repository";
import { ContentRefSchema, type ContentLocale, type ContentRef } from "./schema";

/** Exact installed package used for new desktop saves; old saves retain their own ref. */
export const DEFAULT_BUNDLED_CONTENT_REF: Readonly<ContentRef> = Object.freeze({
  packageId: "minimal-test-package",
  version: "1.1.0",
});

/** Read and validate the whole immutable package before exposing either catalog. */
export class BundledSplitContentRepository implements SplitContentRepository {
  constructor(private readonly readPackage: BundledPackageReader = readBundledContentPackage) {}

  private async loadPackage(ref: ContentRef) {
    const parsed = ContentRefSchema.safeParse(ref);
    if (!parsed.success) {
      throw new ContentRepositoryError(
        "INVALID_REF",
        "Invalid bundled content reference.",
        parsed.error,
      );
    }
    let files;
    try {
      files = await this.readPackage(parsed.data);
    } catch (error) {
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
      throw new ContentRepositoryError(
        "INVALID_CONTENT",
        "The bundled content package is invalid.",
        result.issues,
      );
    }
    return result;
  }

  async loadGameContent(ref: ContentRef) {
    return (await this.loadPackage(ref)).gameContent;
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
