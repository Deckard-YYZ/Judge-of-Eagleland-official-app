import { ContentRefSchema, type ContentCatalog, type ContentRef } from "./schema";
import { validateContentCatalog, type ContentValidationIssue } from "./validate";

export type ContentRepositoryErrorCode =
  "INVALID_REF" | "INVALID_CONTENT" | "CONTENT_ALREADY_EXISTS" | "CONTENT_NOT_FOUND";

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

/** 内容读取的单一异步入口；调用方按 packageId + version 精确绑定内容。 */
export interface ContentRepository {
  load(ref: ContentRef): Promise<Readonly<ContentCatalog>>;
}

const keyFor = (ref: ContentRef): string => JSON.stringify([ref.packageId, ref.version]);

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

const validateCatalog = (catalog: unknown, context: "supplied" | "stored"): ContentCatalog => {
  const result = validateContentCatalog(catalog);
  if (!result.ok) {
    const issues = readonlyIssues(result.issues);
    throw new ContentRepositoryError(
      "INVALID_CONTENT",
      `The ${context} content catalog is invalid (${issues.length} content issue(s)).`,
      issues,
    );
  }
  return result.catalog as ContentCatalog;
};

/**
 * 内置内容的轻量替身。注册时和读取时均复制并解析，避免 fake 暴露其内部可变对象。
 * 未注册的任何 packageId/version 组合都会明确拒绝，不会回退到“当前版本”。
 */
export class FakeContentRepository implements ContentRepository {
  private readonly catalogs = new Map<string, ContentCatalog>();

  constructor(initialCatalogs: readonly ContentCatalog[] = []) {
    for (const catalog of initialCatalogs) {
      this.register(catalog);
    }
  }

  register(catalog: ContentCatalog): void {
    const parsed = validateCatalog(catalog, "supplied");
    const ref = parseRef({
      packageId: parsed.manifest.packageId,
      version: parsed.manifest.version,
    });
    const key = keyFor(ref);

    if (this.catalogs.has(key)) {
      throw new ContentRepositoryError(
        "CONTENT_ALREADY_EXISTS",
        `Content ${ref.packageId}@${ref.version} is already registered.`,
      );
    }

    this.catalogs.set(key, parsed);
  }

  async load(ref: ContentRef): Promise<Readonly<ContentCatalog>> {
    const parsedRef = parseRef(ref);
    const stored = this.catalogs.get(keyFor(parsedRef));

    if (!stored) {
      throw new ContentRepositoryError(
        "CONTENT_NOT_FOUND",
        `Content ${parsedRef.packageId}@${parsedRef.version} is not available.`,
      );
    }

    // Revalidate at the read boundary as a defense against corrupted adapters or test stores.
    return validateCatalog(stored, "stored");
  }
}
