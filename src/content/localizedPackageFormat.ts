import { SUPPORTED_LOCALES } from "../shared/locale";
import type { ContentLocale, GameContentCatalog, LocalizedContentCatalog } from "./schema";
import {
  sortContentValidationIssues,
  validateGameContentCatalog,
  validateLocalizedContentCatalog,
  type ContentValidationIssue,
} from "./validate";
export interface ContentPackageSource {
  readonly source: string;
  readonly text: string;
}

export interface ContentPackageLoadOptions {
  /** Complete package-relative inventory when physical asset existence should be checked. */
  readonly fileInventory?: readonly string[];
  readonly expectedPackageId?: string;
  readonly expectedVersion?: string;
}

export type SplitContentPackageLoadResult =
  | {
      readonly ok: true;
      readonly gameContent: Readonly<GameContentCatalog>;
      readonly localizations: Readonly<Record<ContentLocale, LocalizedContentCatalog>>;
      readonly issues: readonly [];
    }
  | { readonly ok: false; readonly issues: readonly ContentValidationIssue[] };

const issue = (
  code: ContentValidationIssue["code"],
  source: string,
  objectId: string,
  message: string,
): ContentValidationIssue => ({ code, source, objectId, path: [], message });

const parseJson = (entry: ContentPackageSource): unknown => JSON.parse(entry.text) as unknown;

/**
 * Schema-v2 physical package loader. `game.json` contains the single rules graph;
 * each `locales/<AppLocale>.json` contains only strict presentation data.
 */
export function loadSplitContentPackage(
  sources: readonly ContentPackageSource[],
  options: ContentPackageLoadOptions = {},
): SplitContentPackageLoadResult {
  const issues: ContentValidationIssue[] = [];
  const bySource = new Map<string, ContentPackageSource[]>();
  for (const entry of sources) {
    const entries = bySource.get(entry.source) ?? [];
    entries.push(entry);
    bySource.set(entry.source, entries);
    if (entry.source !== "game.json" && !/^locales\/[^/]+\.json$/u.test(entry.source)) {
      issues.push(
        issue(
          "CONTENT_PACKAGE_FILE_UNRECOGNIZED",
          entry.source,
          "package",
          `File "${entry.source}" is not part of the schema-v2 package layout.`,
        ),
      );
    }
  }

  for (const [source, entries] of bySource) {
    if (entries.length > 1) {
      issues.push(
        issue(
          "CONTENT_PACKAGE_FILE_DUPLICATE",
          source,
          source === "game.json" ? "game" : "localization",
          `File "${source}" appears ${entries.length} times.`,
        ),
      );
    }
  }
  if (!bySource.has("game.json")) {
    issues.push(
      issue(
        "CONTENT_PACKAGE_FILE_MISSING",
        "game.json",
        "game",
        'Required schema-v2 file "game.json" is missing.',
      ),
    );
  }

  const readOne = (source: string): unknown | undefined => {
    const entries = bySource.get(source);
    if (!entries || entries.length !== 1) return undefined;
    try {
      return parseJson(entries[0]);
    } catch {
      issues.push(
        issue(
          "CONTENT_PACKAGE_JSON_INVALID",
          source,
          source === "game.json" ? "game" : "localization",
          `File "${source}" is not valid JSON.`,
        ),
      );
      return undefined;
    }
  };

  const rawGameContent = readOne("game.json");
  if (rawGameContent === undefined) {
    return { ok: false, issues: sortContentValidationIssues(issues) };
  }
  const gameResult = validateGameContentCatalog(rawGameContent, {
    source: "game.json",
    fileInventory: options.fileInventory,
    expectedPackageId: options.expectedPackageId,
    expectedVersion: options.expectedVersion,
  });
  if (!gameResult.ok) {
    issues.push(...gameResult.issues);
    return { ok: false, issues: sortContentValidationIssues(issues) };
  }

  const localizedByLocale = {} as Record<ContentLocale, LocalizedContentCatalog>;
  for (const locale of gameResult.catalog.manifest.supportedLocales) {
    const source = `locales/${locale}.json`;
    if (!bySource.has(source)) {
      issues.push(
        issue(
          "CONTENT_PACKAGE_FILE_MISSING",
          source,
          locale,
          `Manifest declares ${locale}, but "${source}" is missing.`,
        ),
      );
      continue;
    }
    const rawLocalized = readOne(source);
    if (rawLocalized === undefined) continue;
    const result = validateLocalizedContentCatalog(rawLocalized, gameResult.catalog, {
      source,
      expectedLocale: locale,
    });
    if (!result.ok) issues.push(...result.issues);
    else localizedByLocale[locale] = result.catalog as LocalizedContentCatalog;
  }

  for (const source of bySource.keys()) {
    const match = /^locales\/([^/]+)\.json$/u.exec(source);
    if (!match) continue;
    const locale = match[1];
    if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
      issues.push(
        issue(
          "LOCALIZATION_LOCALE_UNSUPPORTED",
          source,
          locale,
          `Locale key "${locale}" is not supported by the application.`,
        ),
      );
    } else if (!gameResult.catalog.manifest.supportedLocales.includes(locale as ContentLocale)) {
      issues.push(
        issue(
          "LOCALIZATION_ID_EXTRA",
          source,
          locale,
          `Locale "${locale}" is not declared by the manifest.`,
        ),
      );
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues: sortContentValidationIssues(issues) };
  }
  const localizations = Object.freeze(localizedByLocale);
  return {
    ok: true,
    gameContent: gameResult.catalog,
    localizations,
    issues: [],
  };
}
