import { convertFileSrc as tauriConvertFileSrc } from "@tauri-apps/api/core";
import { resolveResource as tauriResolveResource } from "@tauri-apps/api/path";
import { detectRuntime, type RuntimeInfo, type RuntimeKind } from "./runtime";

/**
 * The platform module deliberately repeats this small shape instead of
 * importing `content/schema`. Content may depend on the platform adapter, but
 * the platform must remain usable without loading the content layer.
 */
export type AssetKind = "image" | "video" | "audio";

export interface AssetDefinitionLike {
  readonly kind: AssetKind;
  /** A normalized package-relative path using `/` separators. */
  readonly path: string;
}

export interface AssetPackageRef {
  readonly packageId: string;
  readonly version: string;
}

/** Structural view accepted from `GameContentCatalog`. */
export interface AssetCatalogLike {
  readonly manifest: AssetPackageRef;
  readonly assets: Readonly<Record<string, AssetDefinitionLike>>;
}

export type AssetResolverErrorCode =
  | "INVALID_REF"
  | "INVALID_ASSET_ID"
  | "ASSET_NOT_FOUND"
  | "ASSET_KIND_INVALID"
  | "ASSET_PATH_INVALID"
  | "ASSET_RESOLUTION_FAILED";

export class AssetResolverError extends Error {
  readonly code: AssetResolverErrorCode;
  readonly cause?: unknown;

  constructor(code: AssetResolverErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "AssetResolverError";
    this.code = code;
    this.cause = cause;
  }
}

export const isAssetResolverError = (error: unknown): error is AssetResolverError =>
  error instanceof AssetResolverError;

export interface AssetResolverDependencies {
  /** Override the detected runtime in tests or an embedding shell. */
  readonly runtime?: RuntimeInfo | RuntimeKind;
  /** Tauri's resource path resolver. Kept injectable for platform-free tests. */
  readonly resolveResource?: (resourcePath: string) => Promise<string>;
  /** Tauri's asset protocol converter. Kept injectable for platform-free tests. */
  readonly convertFileSrc?: (filePath: string) => string;
  /** Browser-only base path when a static host exposes `content/` directly. */
  readonly browserBaseUrl?: string;
}

/** Destination selected by `bundle.resources` in `src-tauri/tauri.conf.json`. */
export const BUNDLED_CONTENT_ROOT = "content";

const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;
const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z\d+.-]*:/u;
const WINDOWS_FORBIDDEN_CHARACTER_PATTERN = /[<>:"|?*]/u;

const invalidRef = (field: string): AssetResolverError =>
  new AssetResolverError("INVALID_REF", `Content reference ${field} must be a safe path segment.`);

function assertSafeRefSegment(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    WINDOWS_FORBIDDEN_CHARACTER_PATTERN.test(value) ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    value.endsWith(".") ||
    value.endsWith(" ")
  ) {
    throw invalidRef(field);
  }
}

const invalidAssetPath = (path: string, message: string): AssetResolverError =>
  new AssetResolverError("ASSET_PATH_INVALID", `Asset path "${path}" ${message}.`);

const decodedPathSegment = (path: string, segment: string): string => {
  let decoded = segment;
  // Decode more than once so `%252e%252e` cannot become `..` after a second
  // URL decoding step in a host or WebView.
  for (let pass = 0; pass < 3 && decoded.includes("%"); pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch (error) {
      throw new AssetResolverError(
        "ASSET_PATH_INVALID",
        `Asset path "${path}" contains malformed percent encoding.`,
        error,
      );
    }
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
};

const assertSafePathSegment = (path: string, segment: string): void => {
  const decoded = decodedPathSegment(path, segment);
  if (
    decoded === "." ||
    decoded === ".." ||
    decoded.includes("/") ||
    decoded.includes("\\") ||
    decoded.includes("?") ||
    decoded.includes("#") ||
    WINDOWS_FORBIDDEN_CHARACTER_PATTERN.test(decoded) ||
    CONTROL_CHARACTER_PATTERN.test(decoded) ||
    decoded.endsWith(".") ||
    decoded.endsWith(" ")
  ) {
    throw invalidAssetPath(path, "contains a path segment that is unsafe on the target platform");
  }
};

/**
 * Keep this check at the platform boundary even though content validation also
 * checks it. A resolver must never turn an untrusted catalog value into an
 * arbitrary file URL when called by a future repository implementation.
 */
export function assertSafeAssetPath(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AssetResolverError(
      "ASSET_PATH_INVALID",
      "Asset paths must be non-empty package-relative strings.",
    );
  }
  if (URL_SCHEME_PATTERN.test(value) || value.includes("://")) {
    throw invalidAssetPath(value, "must not be URL-like or drive-prefixed");
  }
  if (value.startsWith("/") || value.includes("\\")) {
    throw invalidAssetPath(value, "must be package-relative and use \"/\" separators");
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    throw invalidAssetPath(value, "must not contain control characters");
  }
  if (value.includes("?") || value.includes("#")) {
    throw invalidAssetPath(value, "must not contain a query or fragment");
  }

  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0)) {
    throw invalidAssetPath(value, "contains an empty path segment");
  }
  for (const segment of segments) assertSafePathSegment(value, segment);
}

function assertAssetId(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new AssetResolverError("INVALID_ASSET_ID", "Asset ID must be a non-empty string.");
  }
}

const assertCatalog = (catalog: AssetCatalogLike): void => {
  if (!catalog || typeof catalog !== "object") {
    throw new AssetResolverError("INVALID_REF", "An asset catalog is required.");
  }
  const manifest = catalog.manifest;
  if (!manifest || typeof manifest !== "object") {
    throw new AssetResolverError("INVALID_REF", "Asset catalog manifest is required.");
  }
  assertSafeRefSegment(manifest.packageId, "packageId");
  assertSafeRefSegment(manifest.version, "version");
  if (!catalog.assets || typeof catalog.assets !== "object") {
    throw new AssetResolverError("INVALID_REF", "Asset catalog assets are required.");
  }
};

function assertBrowserBase(value: string): string {
  if (
    value.length === 0 ||
    value.startsWith("//") ||
    URL_SCHEME_PATTERN.test(value) ||
    value.includes("://") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new AssetResolverError(
      "ASSET_RESOLUTION_FAILED",
      "Browser asset base must be a local URL path.",
    );
  }
  const base = value.startsWith("/") ? value : `/${value}`;
  const segments = base.split("/");
  const interior = segments.slice(1, segments.at(-1) === "" ? -1 : undefined);
  if (interior.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new AssetResolverError(
      "ASSET_RESOLUTION_FAILED",
      "Browser asset base must not contain empty or dot path segments.",
    );
  }
  return base.endsWith("/") ? base : `${base}/`;
}

const encodePath = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

/** Build the path passed to Tauri's `resolveResource` without using OS joins. */
export function bundledResourcePath(ref: AssetPackageRef, assetPath: string): string {
  assertSafeRefSegment(ref.packageId, "packageId");
  assertSafeRefSegment(ref.version, "version");
  assertSafeAssetPath(assetPath);
  return `${BUNDLED_CONTENT_ROOT}/${ref.packageId}/${ref.version}/${assetPath}`;
}

/**
 * Resolves a content asset to a URL suitable for `<img>`/`<video>`/`<audio>`.
 *
 * In Tauri, the resolver first obtains the actual bundled resource path and
 * then converts it through the configured asset protocol. In browser preview,
 * it returns a local `/content/...` URL; this keeps preview code deterministic
 * without granting a browser page access to arbitrary local files.
 */
export interface AssetResolver {
  resolve(
    catalog: AssetCatalogLike,
    assetId: string,
  ): Promise<string>;
  resolve(assetId: string, catalog: AssetCatalogLike): Promise<string>;
  resolveAsset(
    catalog: AssetCatalogLike,
    assetId: string,
  ): Promise<ResolvedAsset>;
  resolveAsset(assetId: string, catalog: AssetCatalogLike): Promise<ResolvedAsset>;
  resolveUrl(catalog: AssetCatalogLike, assetId: string): Promise<string>;
}

export class RuntimeAssetResolver implements AssetResolver {
  private readonly runtimeKind: RuntimeKind;
  private readonly resolveResource: (resourcePath: string) => Promise<string>;
  private readonly convertFileSrc: (filePath: string) => string;
  private readonly browserBaseUrl: string;

  constructor(dependencies: AssetResolverDependencies = {}) {
    const runtime = dependencies.runtime ?? detectRuntime();
    this.runtimeKind = typeof runtime === "string" ? runtime : runtime.kind;
    this.resolveResource = dependencies.resolveResource ?? tauriResolveResource;
    this.convertFileSrc = dependencies.convertFileSrc ?? tauriConvertFileSrc;
    this.browserBaseUrl = assertBrowserBase(dependencies.browserBaseUrl ?? "/content/");
  }

  async resolve(
    first: AssetCatalogLike | string,
    second: AssetCatalogLike | string,
  ): Promise<string> {
    return (await this.resolveAsset(first as never, second as never)).url;
  }

  async resolveAsset(
    first: AssetCatalogLike | string,
    second: AssetCatalogLike | string,
  ): Promise<ResolvedAsset> {
    const { catalog, assetId } = parseResolveArguments(first, second);
    assertCatalog(catalog);
    assertAssetId(assetId);

    if (!Object.hasOwn(catalog.assets, assetId)) {
      throw new AssetResolverError(
        "ASSET_NOT_FOUND",
        `Asset "${assetId}" is not defined by content ${catalog.manifest.packageId}@${catalog.manifest.version}.`,
      );
    }
    const definition = catalog.assets[assetId];
    if (!definition || typeof definition !== "object") {
      throw new AssetResolverError(
        "ASSET_PATH_INVALID",
        `Asset "${assetId}" does not contain a valid definition.`,
      );
    }
    assertSafeAssetPath(definition.path);
    const resourcePath = bundledResourcePath(catalog.manifest, definition.path);

    try {
      const resolvedPath =
        this.runtimeKind === "tauri" ? await this.resolveResource(resourcePath) : resourcePath;
      if (typeof resolvedPath !== "string" || resolvedPath.length === 0) {
        throw new Error("Tauri returned an empty resource path.");
      }
      const url =
        this.runtimeKind === "tauri"
          ? this.convertFileSrc(resolvedPath)
          : `${this.browserBaseUrl}${encodePath(resourcePath.slice(`${BUNDLED_CONTENT_ROOT}/`.length))}`;
      if (typeof url !== "string" || url.length === 0) {
        throw new Error("Asset URL conversion returned an empty URL.");
      }
      return Object.freeze({
        assetId,
        kind: definition.kind,
        packageRelativePath: definition.path,
        resourcePath,
        url,
      });
    } catch (error) {
      if (error instanceof AssetResolverError) throw error;
      throw new AssetResolverError(
        "ASSET_RESOLUTION_FAILED",
        `Asset "${assetId}" could not be resolved for content ${catalog.manifest.packageId}@${catalog.manifest.version}.`,
        error,
      );
    }
  }

  async resolveUrl(catalog: AssetCatalogLike, assetId: string): Promise<string> {
    return this.resolve(catalog, assetId);
  }
}

/** Factory keeps the default Tauri API at the platform edge and is convenient for tests. */
export const createAssetResolver = (
  dependencies: AssetResolverDependencies = {},
): AssetResolver => new RuntimeAssetResolver(dependencies);

export async function resolveAssetUrl(
  catalog: AssetCatalogLike,
  assetId: string,
  dependencies: AssetResolverDependencies = {},
): Promise<string> {
  return createAssetResolver(dependencies).resolve(catalog, assetId);
}
