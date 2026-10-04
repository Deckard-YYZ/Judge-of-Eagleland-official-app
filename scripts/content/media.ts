import { execFileSync } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { AssetDefinition } from "../../src/content/schema";

/** Portable relative paths follow the same restrictions as the runtime asset resolver. */
export function assertPackagePath(value: string): void {
  if (
    !value ||
    value.includes("\\") ||
    /[%#?<>:"|*\p{Cc}\p{Cf}\uD800-\uDFFF]/u.test(value) ||
    value
      .split("/")
      .some(
        (segment) =>
          !segment ||
          segment === "." ||
          segment === ".." ||
          /[. ]$/u.test(segment) ||
          /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/iu.test(segment),
      )
  )
    throw new Error(`PACKAGE_PATH_INVALID: ${value}`);
}

/** Reject directory junctions as well as symbolic links, including links within the root. */
export async function assertNoLinks(filename: string | readonly string[]): Promise<void> {
  const uniqueComponents = new Set<string>();
  for (const target of typeof filename === "string" ? [filename] : filename) {
    const ancestors: string[] = [];
    for (let current = path.resolve(target); ; current = path.dirname(current)) {
      ancestors.unshift(current);
      if (path.dirname(current) === current) break;
    }
    for (const component of ancestors) uniqueComponents.add(component);
  }
  const components = [...uniqueComponents];
  for (const component of components) {
    const info = await lstat(component);
    if (info.isSymbolicLink()) throw new Error(`PACKAGE_LINK_UNSUPPORTED: ${component}`);
  }
  if (process.platform === "win32") {
    // Node exposes junctions as links, but not every Windows reparse-point type.
    // Paths are passed as JSON in the environment, never interpolated into shell code.
    const found = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        '$ErrorActionPreference = "Stop"; foreach ($itemPath in (ConvertFrom-Json $env:CONTENT_AUTHORING_LINK_PATHS)) { $item = Get-Item -LiteralPath $itemPath -Force; if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Write-Output "reparse"; break } }',
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000,
        env: { ...process.env, CONTENT_AUTHORING_LINK_PATHS: JSON.stringify(components) },
      },
    ).trim();
    if (found) throw new Error(`PACKAGE_LINK_UNSUPPORTED: ${filename}`);
  }
}

export class MediaSourceError extends Error {
  constructor(
    readonly assetId: string,
    readonly assetPath: string,
    cause: unknown,
  ) {
    super(`MEDIA_SOURCE_INVALID: asset=${assetId} path=${assetPath}: ${String(cause)}`, { cause });
  }
}

/** Read each declared asset as bytes; neither unlisted files nor author metadata are published. */
export async function readAuthoringMedia(
  source: string,
  assets: Readonly<Record<string, AssetDefinition>>,
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const portableNames = new Map<string, string>();
  // Reject invalid declarations before filesystem or shell access.
  for (const [assetId, asset] of Object.entries(assets)) {
    try {
      assertPackagePath(asset.path);
      if (!asset.path.startsWith("media/")) throw new Error("Assets must be under media/");
      const portableName = asset.path.normalize("NFC").toLowerCase();
      const previous = portableNames.get(portableName);
      if (previous && previous !== asset.path)
        throw new Error(`Case-insensitive path collision with ${previous}`);
      portableNames.set(portableName, asset.path);
    } catch (error) {
      throw new MediaSourceError(assetId, asset.path, error);
    }
  }
  const sourceRoot = path.resolve(source);
  await assertNoLinks(sourceRoot);
  const canonicalRoot = await realpath(sourceRoot);
  for (const [assetId, asset] of Object.entries(assets)) {
    try {
      if (files.has(asset.path)) continue;
      const filename = path.join(sourceRoot, asset.path);
      await assertNoLinks(filename);
      const canonical = await realpath(filename);
      const relative = path.relative(canonicalRoot, canonical);
      if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative))
        throw new Error("Asset escapes the author source directory");
      if (!(await lstat(filename)).isFile()) throw new Error("Asset must be a regular file");
      files.set(asset.path, await readFile(filename));
    } catch (error) {
      throw new MediaSourceError(assetId, asset.path, error);
    }
  }
  return files;
}
