import { getDiagnostics } from "../shared/diagnostics";
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
const BUNDLED_CONTENT_ROOT = "content";

const CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u;
const WINDOWS_FORBIDDEN_CHARACTER_PATTERN = /[<>:"|?*]/u;
const WINDOWS_RESERVED_NAME_PATTERN = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/iu;

/** `encodeURIComponent` rejects lone UTF-16 surrogates; reject them at the path boundary. */
const hasUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
};

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
    value.includes("%") ||
    value.includes("#") ||
    hasUnpairedSurrogate(value) ||
    WINDOWS_FORBIDDEN_CHARACTER_PATTERN.test(value) ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    WINDOWS_RESERVED_NAME_PATTERN.test(value) ||
    value.endsWith(".") ||
    value.endsWith(" ")
  ) {
    throw invalidRef(field);
  }
}

const invalidAssetPath = (path: string, message: string): AssetResolverError =>
  new AssetResolverError("ASSET_PATH_INVALID", `Asset path "${path}" ${message}.`);

const assertSafePathSegment = (path: string, segment: string): void => {
  if (
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.includes("%") ||
    hasUnpairedSurrogate(segment) ||
    WINDOWS_FORBIDDEN_CHARACTER_PATTERN.test(segment) ||
    WINDOWS_RESERVED_NAME_PATTERN.test(segment) ||
    CONTROL_CHARACTER_PATTERN.test(segment) ||
    segment.endsWith(".") ||
    segment.endsWith(" ")
  ) {
    throw invalidAssetPath(path, "contains a path segment that is unsafe on the target platform");
  }
};

/**
 * Validate a package-relative path once, before it reaches either a native
 * path resolver or a browser URL builder. Percent signs are rejected outright
 * so an encoded separator or dot segment cannot appear after a later decode.
 */
function assertSafeAssetPath(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AssetResolverError(
      "ASSET_PATH_INVALID",
      "Asset paths must be non-empty package-relative strings.",
    );
  }
  if (value.startsWith("/") || value.includes("\\")) {
    throw invalidAssetPath(value, 'must be package-relative and use "/" separators');
  }
  if (value.includes("%")) {
    throw invalidAssetPath(value, "must not contain percent-encoded path data");
  }
  if (hasUnpairedSurrogate(value)) {
    throw invalidAssetPath(value, "must contain well-formed Unicode");
  }
  if (value.includes("?") || value.includes("#")) {
    throw invalidAssetPath(value, "must not contain a query or fragment");
  }

  const segments = value.split("/");
  for (const segment of segments) assertSafePathSegment(value, segment);
}

function assertAssetKind(value: unknown): asserts value is AssetKind {
  if (value !== "image" && value !== "video" && value !== "audio") {
    throw new AssetResolverError(
      "ASSET_KIND_INVALID",
      'Asset kind must be one of "image", "video", or "audio".',
    );
  }
}

function assertAssetId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    hasUnpairedSurrogate(value)
  ) {
    throw new AssetResolverError("INVALID_ASSET_ID", "Asset ID must be a non-empty string.");
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function assertCatalog(value: unknown): asserts value is AssetCatalogLike {
  if (!isObject(value)) {
    throw new AssetResolverError("INVALID_REF", "An asset catalog is required.");
  }
  const manifest = value.manifest;
  if (!isObject(manifest)) {
    throw new AssetResolverError("INVALID_REF", "Asset catalog manifest is required.");
  }
  assertSafeRefSegment(manifest.packageId, "packageId");
  assertSafeRefSegment(manifest.version, "version");
  if (!isObject(value.assets)) {
    throw new AssetResolverError("INVALID_REF", "Asset catalog assets are required.");
  }
}

const invalidBrowserBase = (): AssetResolverError =>
  new AssetResolverError(
    "ASSET_RESOLUTION_FAILED",
    "Browser asset base must be a safe local URL path.",
  );

function assertBrowserBase(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw invalidBrowserBase();
  if (
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("%") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes(":") ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    hasUnpairedSurrogate(value)
  ) {
    throw invalidBrowserBase();
  }

  const base = value.startsWith("/") ? value : `/${value}`;
  const withoutTrailingSlash = base.endsWith("/") ? base.slice(0, -1) : base;
  const segments = withoutTrailingSlash.slice(1).split("/");
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    throw invalidBrowserBase();
  }
  for (const segment of segments) {
    try {
      assertSafePathSegment(base, segment);
    } catch {
      throw invalidBrowserBase();
    }
  }
  return `${withoutTrailingSlash}/`;
}

const encodePath = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

/** Build the path passed to Tauri's `resolveResource` without using OS joins. */
const bundledResourcePath = (ref: AssetPackageRef, assetPath: string): string => {
  assertSafeRefSegment(ref.packageId, "packageId");
  assertSafeRefSegment(ref.version, "version");
  assertSafeAssetPath(assetPath);
  return `${BUNDLED_CONTENT_ROOT}/${ref.packageId}/${ref.version}/${assetPath}`;
};

export interface AssetResolver {
  resolve(catalog: AssetCatalogLike, assetId: string): Promise<string>;
}

/**
 * Resolves a content asset to a URL suitable for `<img>`/`<video>`/`<audio>`.
 *
 * In Tauri, the resolver first obtains the actual bundled resource path and
 * then converts it through the configured asset protocol. In browser preview,
 * it returns a local URL rooted at `browserBaseUrl`.
 */
class RuntimeAssetResolver implements AssetResolver {
  private readonly runtimeKind: RuntimeKind;
  private readonly resolveResource: (resourcePath: string) => Promise<string>;
  private readonly convertFileSrc: (filePath: string) => string;
  private readonly browserBaseUrl: string;

  constructor(dependencies: AssetResolverDependencies = {}) {
    const runtime = dependencies.runtime ?? detectRuntime();
    this.runtimeKind = typeof runtime === "string" ? runtime : runtime.kind;
    if (this.runtimeKind !== "tauri" && this.runtimeKind !== "browser") {
      throw new AssetResolverError("ASSET_RESOLUTION_FAILED", "Runtime kind is invalid.");
    }
    this.resolveResource = dependencies.resolveResource ?? tauriResolveResource;
    this.convertFileSrc = dependencies.convertFileSrc ?? tauriConvertFileSrc;
    this.browserBaseUrl = assertBrowserBase(dependencies.browserBaseUrl ?? "/content/");
  }

  async resolve(catalog: AssetCatalogLike, assetId: string): Promise<string> {
    assertCatalog(catalog);
    assertAssetId(assetId);

    if (!Object.hasOwn(catalog.assets, assetId)) {
      throw new AssetResolverError(
        "ASSET_NOT_FOUND",
        `Asset "${assetId}" is not defined by content ${catalog.manifest.packageId}@${catalog.manifest.version}.`,
      );
    }
    const definition = catalog.assets[assetId] as unknown;
    if (!isObject(definition)) {
      throw new AssetResolverError(
        "ASSET_PATH_INVALID",
        `Asset "${assetId}" does not contain a valid definition.`,
      );
    }
    assertAssetKind(definition.kind);
    assertSafeAssetPath(definition.path);
    const resourcePath = bundledResourcePath(catalog.manifest, definition.path);

    try {
      if (this.runtimeKind === "browser") {
        const packageRelativePath = resourcePath.slice(`${BUNDLED_CONTENT_ROOT}/`.length);
        return `${this.browserBaseUrl}${encodePath(packageRelativePath)}`;
      }

      const resolvedPath = await this.resolveResource(resourcePath);
      if (typeof resolvedPath !== "string" || resolvedPath.length === 0) {
        throw new Error("Tauri returned an empty resource path.");
      }
      const url = this.convertFileSrc(resolvedPath);
      if (typeof url !== "string" || url.length === 0) {
        throw new Error("Asset URL conversion returned an empty URL.");
      }
      return url;
    } catch (error) {
      getDiagnostics().record({
        source: "assets",
        event: "asset.resolution_failed",
        level: "error",
        data: {
          resource: assetId,
          contentPackageId: catalog.manifest.packageId,
          contentVersion: catalog.manifest.version,
        },
        error,
      });
      if (error instanceof AssetResolverError) throw error;
      throw new AssetResolverError(
        "ASSET_RESOLUTION_FAILED",
        `Asset "${assetId}" could not be resolved for content ${catalog.manifest.packageId}@${catalog.manifest.version}.`,
        error,
      );
    }
  }
}

/** Factory keeps the default Tauri API at the platform edge and is convenient for tests. */
export const createAssetResolver = (dependencies: AssetResolverDependencies = {}): AssetResolver =>
  new RuntimeAssetResolver(dependencies);
