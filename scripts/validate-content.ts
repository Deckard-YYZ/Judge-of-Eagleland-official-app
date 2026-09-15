import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  loadSplitContentPackage,
  type ContentPackageSource,
} from "../src/content/localizedPackageFormat";
import type { ContentValidationPath } from "../src/content/validate";

const DEFAULT_CONTENT_ROOT = "content";
const PACKAGE_MARKERS = new Set(["game.json"]);

const compareNames = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const usage = (): string =>
  [
    "Usage: npm run validate:content -- [package-directory-or-content-root ...]",
    `With no arguments, packages are discovered below ./${DEFAULT_CONTENT_ROOT}/<packageId>/<version>/.`,
  ].join("\n");

const directoryEntries = async (directory: string) =>
  (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
    compareNames(left.name, right.name),
  );

const looksLikePackageDirectory = async (directory: string): Promise<boolean> => {
  const entries = await directoryEntries(directory);
  return entries.some((entry) => PACKAGE_MARKERS.has(entry.name));
};

const childDirectories = async (directory: string): Promise<string[]> =>
  (await directoryEntries(directory))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directory, entry.name));

/**
 * A target may be one package directory, a package-id directory, or the content root. Discovery
 * intentionally stops at the architecture's two directory levels instead of scanning media trees.
 */
const discoverPackageDirectories = async (target: string): Promise<string[]> => {
  const targetStat = await stat(target);
  if (!targetStat.isDirectory()) {
    throw new Error("target is not a directory");
  }
  if (await looksLikePackageDirectory(target)) {
    return [target];
  }

  const firstLevel = await childDirectories(target);
  const packages: string[] = [];
  for (const child of firstLevel) {
    if (await looksLikePackageDirectory(child)) {
      packages.push(child);
      continue;
    }
    for (const grandchild of await childDirectories(child)) {
      if (await looksLikePackageDirectory(grandchild)) {
        packages.push(grandchild);
      }
    }
  }
  return packages;
};

/** Recursion is limited to one selected package; inventory keeps media without reading it as text. */
const collectPackageFiles = async (packageDirectory: string): Promise<string[]> => {
  const files: string[] = [];
  const pending = [packageDirectory];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) {
      continue;
    }
    for (const entry of await directoryEntries(directory)) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(filename);
      } else if (entry.isFile()) {
        files.push(filename);
      }
    }
  }
  return files.sort(compareNames);
};

// Content core receives OS-independent package-relative source names; no platform separator leaks in.
const packageRelativeSource = (packageDirectory: string, filename: string): string =>
  path.relative(packageDirectory, filename).split(path.sep).join("/");

const readPackageInput = async (packageDirectory: string) => {
  const filenames = await collectPackageFiles(packageDirectory);
  const inventory = filenames.map((filename) => packageRelativeSource(packageDirectory, filename));
  const jsonFilenames = filenames.filter((filename) => /\.json$/iu.test(filename));
  const sources: ContentPackageSource[] = [];
  for (const filename of jsonFilenames) {
    sources.push({
      source: packageRelativeSource(packageDirectory, filename),
      text: await readFile(filename, "utf8"),
    });
  }
  return { sources, inventory } as const;
};

const formatFieldPath = (fieldPath: ContentValidationPath): string => {
  if (fieldPath.length === 0) {
    return "<root>";
  }
  return fieldPath.reduce<string>((formatted, segment, index) => {
    if (typeof segment === "number") {
      return `${formatted}[${segment}]`;
    }
    if (/^[A-Za-z_$][A-Za-z\d_$]*$/u.test(segment)) {
      return index === 0 ? segment : `${formatted}.${segment}`;
    }
    return `${formatted}[${JSON.stringify(segment)}]`;
  }, "");
};

const displayPath = (filename: string): string => path.relative(process.cwd(), filename) || ".";

const validatePackageDirectory = async (packageDirectory: string): Promise<boolean> => {
  const { sources, inventory } = await readPackageInput(packageDirectory);
  const expectedPackageId = path.basename(path.dirname(packageDirectory));
  const expectedVersion = path.basename(packageDirectory);
  const options = { fileInventory: inventory, expectedPackageId, expectedVersion };
  const result = loadSplitContentPackage(sources, options);

  if (result.ok) {
    const catalog = result.gameContent;
    console.log(
      `VALID ${displayPath(packageDirectory)} (${catalog.manifest.packageId}@${catalog.manifest.version}, ${Object.keys(catalog.cases).length} cases)`,
    );
    return true;
  }

  for (const issue of result.issues) {
    console.error(
      `${displayPath(packageDirectory)} | ${issue.source} | object=${issue.objectId} | path=${formatFieldPath(issue.path)} | ${issue.code} | ${issue.message}`,
    );
  }
  return false;
};

const main = async (args: readonly string[]): Promise<number> => {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(usage());
    return 0;
  }
  if (args.some((argument) => argument.startsWith("-"))) {
    console.error(usage());
    return 1;
  }

  const targets = (args.length === 0 ? [DEFAULT_CONTENT_ROOT] : args).map((target) =>
    path.resolve(process.cwd(), target),
  );
  const packageDirectories = new Set<string>();
  let failed = false;

  for (const target of targets) {
    try {
      const discovered = await discoverPackageDirectories(target);
      if (discovered.length === 0) {
        console.error(`ERROR ${displayPath(target)}: no content package directories found.`);
        failed = true;
      }
      discovered.forEach((directory) => packageDirectories.add(path.resolve(directory)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`ERROR ${displayPath(target)}: ${message}`);
      failed = true;
    }
  }

  for (const packageDirectory of [...packageDirectories].sort(compareNames)) {
    try {
      if (!(await validatePackageDirectory(packageDirectory))) {
        failed = true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`ERROR ${displayPath(packageDirectory)}: ${message}`);
      failed = true;
    }
  }

  // One non-zero policy covers usage, I/O, and validation failures for local and CI callers.
  return failed ? 1 : 0;
};

process.exitCode = await main(process.argv.slice(2));
