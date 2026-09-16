import type { DiagnosticContext } from "../shared/diagnostics";
import {
  ContentRefSchema,
  type ContentLocale,
  type ContentRef,
  type GameContentCatalog,
  type LocalizedContentCatalog,
} from "./schema";
import {
  validateGameContentCatalog,
  validateLocalizedContentCatalog,
  type ContentValidationIssue,
} from "./validate";

export type ContentRepositoryErrorCode =
  | "INVALID_REF"
  | "INVALID_CONTENT"
  | "CONTENT_ALREADY_EXISTS"
  | "CONTENT_NOT_FOUND"
  | "LOCALIZATION_NOT_FOUND";

export class ContentRepositoryError extends Error {
  readonly code: ContentRepositoryErrorCode;
  readonly cause?: unknown;

  constructor(code: ContentRepositoryErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "ContentRepositoryError";
    this.code = code;
    this.cause = cause;
  }
}

export const isContentRepositoryError = (error: unknown): error is ContentRepositoryError =>
  error instanceof ContentRepositoryError;

/** Rules and language packs remain separately addressable at the repository boundary. */
export interface SplitContentRepository {
  loadGameContent(
    ref: ContentRef,
    diagnostics?: DiagnosticContext,
  ): Promise<Readonly<GameContentCatalog>>;
  loadLocalization(
    ref: ContentRef,
    locale: ContentLocale,
  ): Promise<Readonly<LocalizedContentCatalog>>;
}

export interface ContentPackageRegistration {
  readonly gameContent: GameContentCatalog;
  readonly localizations: Readonly<Record<ContentLocale, LocalizedContentCatalog>>;
}

const keyFor = (ref: ContentRef): string => JSON.stringify([ref.packageId, ref.version]);
const localizationKeyFor = (ref: ContentRef, locale: ContentLocale): string =>
  JSON.stringify([ref.packageId, ref.version, locale]);

const parseRef = (ref: ContentRef): ContentRef => {
  try {
    return ContentRefSchema.parse(ref);
  } catch (error) {
    throw new ContentRepositoryError(
      "INVALID_REF",
      "The requested content reference is invalid.",
      error,
    );
  }
};

const readonlyIssues = (
  issues: readonly ContentValidationIssue[],
): readonly ContentValidationIssue[] =>
  Object.freeze(
    issues.map((issue) =>
      Object.freeze({
        ...issue,
        path: Object.freeze([...issue.path]),
      }),
    ),
  );

/** In-memory schema-v2 repository used by tests and the later platform adapter contract. */
export class FakeSplitContentRepository implements SplitContentRepository {
  private readonly gameCatalogs = new Map<string, GameContentCatalog>();
  private readonly localizations = new Map<string, LocalizedContentCatalog>();

  constructor(initialPackages: readonly ContentPackageRegistration[] = []) {
    for (const registration of initialPackages) this.register(registration);
  }

  register(registration: ContentPackageRegistration): void {
    const gameResult = validateGameContentCatalog(registration.gameContent);
    if (!gameResult.ok) {
      throw new ContentRepositoryError(
        "INVALID_CONTENT",
        "The supplied game content catalog is invalid.",
        readonlyIssues(gameResult.issues),
      );
    }
    const ref = parseRef({
      packageId: gameResult.catalog.manifest.packageId,
      version: gameResult.catalog.manifest.version,
    });
    const key = keyFor(ref);
    if (this.gameCatalogs.has(key)) {
      throw new ContentRepositoryError(
        "CONTENT_ALREADY_EXISTS",
        `Content ${ref.packageId}@${ref.version} is already registered.`,
      );
    }

    const declared = new Set(gameResult.catalog.manifest.supportedLocales);
    const supplied = new Set(Object.keys(registration.localizations));
    if (declared.size !== supplied.size || [...declared].some((locale) => !supplied.has(locale))) {
      throw new ContentRepositoryError(
        "INVALID_CONTENT",
        "Every declared locale must have exactly one localization catalog.",
      );
    }

    const parsedLocalizations: LocalizedContentCatalog[] = [];
    for (const locale of gameResult.catalog.manifest.supportedLocales) {
      const result = validateLocalizedContentCatalog(
        registration.localizations[locale],
        gameResult.catalog,
        { expectedLocale: locale },
      );
      if (!result.ok) {
        throw new ContentRepositoryError(
          "INVALID_CONTENT",
          `The supplied ${locale} localization catalog is invalid.`,
          readonlyIssues(result.issues),
        );
      }
      parsedLocalizations.push(structuredClone(result.catalog));
    }

    this.gameCatalogs.set(key, structuredClone(gameResult.catalog));
    for (const localized of parsedLocalizations) {
      this.localizations.set(localizationKeyFor(ref, localized.locale), localized);
    }
  }

  async loadGameContent(
    ref: ContentRef,
    diagnostics?: DiagnosticContext,
  ): Promise<Readonly<GameContentCatalog>> {
    const parsedRef = parseRef(ref);
    const stored = this.gameCatalogs.get(keyFor(parsedRef));
    if (!stored) {
      throw new ContentRepositoryError(
        "CONTENT_NOT_FOUND",
        `Content ${parsedRef.packageId}@${parsedRef.version} is not available.`,
      );
    }
    const result = validateGameContentCatalog(stored);
    if (!result.ok) {
      throw new ContentRepositoryError(
        "INVALID_CONTENT",
        "The stored game content catalog is invalid.",
        readonlyIssues(result.issues),
      );
    }
    return structuredClone(result.catalog);
  }

  async loadLocalization(
    ref: ContentRef,
    locale: ContentLocale,
  ): Promise<Readonly<LocalizedContentCatalog>> {
    const parsedRef = parseRef(ref);
    const gameContent = await this.loadGameContent(parsedRef);
    const stored = this.localizations.get(localizationKeyFor(parsedRef, locale));
    if (!stored) {
      throw new ContentRepositoryError(
        "LOCALIZATION_NOT_FOUND",
        `Localization ${locale} for ${parsedRef.packageId}@${parsedRef.version} is not available.`,
      );
    }
    const result = validateLocalizedContentCatalog(stored, gameContent, {
      expectedLocale: locale,
    });
    if (!result.ok) {
      throw new ContentRepositoryError(
        "INVALID_CONTENT",
        "The stored localization catalog is invalid.",
        readonlyIssues(result.issues),
      );
    }
    return structuredClone(result.catalog);
  }
}
