import type { ContentCatalog } from "./schema";
import {
  sortContentValidationIssues,
  validateContentCatalog,
  type ContentValidationIssue,
  type ContentValidationPath,
} from "./validate";

export interface ContentPackageSource {
  readonly source: string;
  readonly text: string;
}

export interface ContentPackageLoadOptions {
  /** Complete package-relative file inventory when physical existence should be checked. */
  readonly fileInventory?: readonly string[];
  readonly expectedPackageId?: string;
  readonly expectedVersion?: string;
}

export interface ContentPackageSourceMap {
  readonly manifest: string;
  readonly attributes: string;
  readonly initial: string;
  readonly progression: string;
  readonly endings: string;
  readonly assets: string;
  readonly cases: Readonly<Record<string, string>>;
  readonly stories: Readonly<Record<string, string>>;
  readonly sourceForPath: (path: ContentValidationPath) => string;
}

export type ContentPackageLoadResult =
  | {
      readonly ok: true;
      readonly catalog: Readonly<ContentCatalog>;
      readonly sourceMap: ContentPackageSourceMap;
      readonly issues: readonly [];
    }
  | {
      readonly ok: false;
      readonly issues: readonly ContentValidationIssue[];
    };

type RootFileName =
  | "manifest.json"
  | "attributes.json"
  | "initial.json"
  | "progression.json"
  | "endings.json"
  | "assets.json";

type PackageFile =
  | { readonly kind: "root"; readonly root: RootFileName }
  | { readonly kind: "case"; readonly id: string }
  | { readonly kind: "story"; readonly id: string };

const PACKAGE_SOURCE = "<package>";
const ROOT_FILES: readonly RootFileName[] = [
  "manifest.json",
  "attributes.json",
  "initial.json",
  "progression.json",
  "endings.json",
  "assets.json",
];

const ROOT_OBJECT_IDS: Readonly<Record<RootFileName, string>> = {
  "manifest.json": "manifest",
  "attributes.json": "attributes",
  "initial.json": "initial",
  "progression.json": "progression",
  "endings.json": "endings",
  "assets.json": "assets",
};

const isSafeStem = (stem: string): boolean =>
  stem.length > 0 &&
  stem !== "." &&
  stem !== ".." &&
  !stem.includes("\\") &&
  !/[\u0000-\u001f]/u.test(stem);

const classifySource = (source: string): PackageFile | undefined => {
  if ((ROOT_FILES as readonly string[]).includes(source)) {
    return { kind: "root", root: source as RootFileName };
  }

  const match = /^(cases|stories)\/([^/]+)\.json$/u.exec(source);
  if (!match || !isSafeStem(match[2])) {
    return undefined;
  }
  return match[1] === "cases" ? { kind: "case", id: match[2] } : { kind: "story", id: match[2] };
};

const packageIssue = (
  code: ContentValidationIssue["code"],
  source: string,
  objectId: string,
  message: string,
  path: ContentValidationPath = [],
): ContentValidationIssue => ({ code, source, objectId, path: [...path], message });

type JsonParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly issue: ContentValidationIssue };

const parseJson = (source: ContentPackageSource, classification: PackageFile): JsonParseResult => {
  try {
    return { ok: true, value: JSON.parse(source.text) as unknown };
  } catch {
    return {
      ok: false,
      issue: packageIssue(
        "CONTENT_PACKAGE_JSON_INVALID",
        source.source,
        classification.kind === "root" ? ROOT_OBJECT_IDS[classification.root] : classification.id,
        `File "${source.source}" is not valid JSON.`,
      ),
    };
  }
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const frozenSourceRecord = (
  entries: readonly (readonly [string, string])[],
): Readonly<Record<string, string>> => {
  const record: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [id, source] of entries) {
    record[id] = source;
  }
  return Object.freeze(record);
};

const createSourceMap = (
  roots: Readonly<Record<RootFileName, ContentPackageSource>>,
  cases: readonly (readonly [string, ContentPackageSource])[],
  stories: readonly (readonly [string, ContentPackageSource])[],
): ContentPackageSourceMap => {
  const caseSources = frozenSourceRecord(cases.map(([id, entry]) => [id, entry.source] as const));
  const storySources = frozenSourceRecord(
    stories.map(([id, entry]) => [id, entry.source] as const),
  );
  const rootSources = {
    manifest: roots["manifest.json"].source,
    attributes: roots["attributes.json"].source,
    initial: roots["initial.json"].source,
    progression: roots["progression.json"].source,
    endings: roots["endings.json"].source,
    assets: roots["assets.json"].source,
  } as const;

  const sourceForPath = (path: ContentValidationPath): string => {
    const [collection, objectId] = path;
    switch (collection) {
      case "manifest":
        return rootSources.manifest;
      case "attributes":
        return rootSources.attributes;
      case "initial":
        return rootSources.initial;
      case "unlockRules":
      case "storyRules":
        return rootSources.progression;
      case "cases":
        return typeof objectId === "string"
          ? (caseSources[objectId] ?? PACKAGE_SOURCE)
          : PACKAGE_SOURCE;
      case "stories":
        return typeof objectId === "string"
          ? (storySources[objectId] ?? PACKAGE_SOURCE)
          : PACKAGE_SOURCE;
      case "endings":
        return rootSources.endings;
      case "assets":
        return rootSources.assets;
      default:
        return PACKAGE_SOURCE;
    }
  };

  return Object.freeze({
    ...rootSources,
    cases: caseSources,
    stories: storySources,
    sourceForPath,
  });
};

const remapCatalogIssues = (
  issues: readonly ContentValidationIssue[],
  sourceMap: ContentPackageSourceMap,
): readonly ContentValidationIssue[] =>
  issues.map((issue) => ({
    ...issue,
    source: sourceMap.sourceForPath(issue.path),
    path: [...issue.path],
  }));

/**
 * Parses the fixed package layout from in-memory text sources. Filesystem discovery and asset
 * existence checks intentionally remain outside this pure C3 boundary.
 */
export const loadContentPackage = (
  sources: readonly ContentPackageSource[],
  options: ContentPackageLoadOptions = {},
): ContentPackageLoadResult => {
  const issues: ContentValidationIssue[] = [];
  const entriesBySource = new Map<string, ContentPackageSource[]>();
  const classificationBySource = new Map<string, PackageFile>();

  for (const entry of sources) {
    const existing = entriesBySource.get(entry.source);
    if (existing) {
      existing.push(entry);
    } else {
      entriesBySource.set(entry.source, [entry]);
    }

    const classification = classifySource(entry.source);
    if (classification) {
      classificationBySource.set(entry.source, classification);
    } else if (!existing) {
      issues.push(
        packageIssue(
          "CONTENT_PACKAGE_FILE_UNRECOGNIZED",
          entry.source,
          "package",
          `File "${entry.source}" is not part of the supported content package layout.`,
        ),
      );
    }
  }

  for (const [source, entries] of entriesBySource) {
    if (entries.length > 1) {
      const classification = classificationBySource.get(source);
      const objectId =
        classification?.kind === "root"
          ? ROOT_OBJECT_IDS[classification.root]
          : classification?.kind === "case" || classification?.kind === "story"
            ? classification.id
            : "package";
      issues.push(
        packageIssue(
          "CONTENT_PACKAGE_FILE_DUPLICATE",
          source,
          objectId,
          `File "${source}" appears ${entries.length} times; duplicate paths cannot be merged.`,
        ),
      );
    }
  }

  const roots = Object.create(null) as Partial<Record<RootFileName, ContentPackageSource>>;
  const caseEntries: [string, ContentPackageSource][] = [];
  const storyEntries: [string, ContentPackageSource][] = [];

  for (const [source, entries] of entriesBySource) {
    if (entries.length !== 1) {
      continue;
    }
    const classification = classificationBySource.get(source);
    if (!classification) {
      continue;
    }
    const entry = entries[0];
    if (classification.kind === "root") {
      roots[classification.root] = entry;
    } else if (classification.kind === "case") {
      caseEntries.push([classification.id, entry]);
    } else {
      storyEntries.push([classification.id, entry]);
    }
  }

  for (const root of ROOT_FILES) {
    if (!entriesBySource.has(root)) {
      issues.push(
        packageIssue(
          "CONTENT_PACKAGE_FILE_MISSING",
          root,
          ROOT_OBJECT_IDS[root],
          `Required content package file "${root}" is missing.`,
        ),
      );
    }
  }

  const parsedBySource = new Map<string, unknown>();
  for (const [source, entries] of entriesBySource) {
    if (entries.length !== 1 || !classificationBySource.has(source)) {
      continue;
    }
    const classification = classificationBySource.get(source);
    if (!classification) {
      continue;
    }
    const parsed = parseJson(entries[0], classification);
    if (!parsed.ok) {
      issues.push(parsed.issue);
    } else {
      parsedBySource.set(source, parsed.value);
    }
  }

  if (issues.length > 0 || ROOT_FILES.some((root) => !parsedBySource.has(root))) {
    return { ok: false, issues: sortContentValidationIssues(issues) };
  }

  const completeRoots = roots as Readonly<Record<RootFileName, ContentPackageSource>>;
  const sourceMap = createSourceMap(completeRoots, caseEntries, storyEntries);
  const cases: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const stories: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [id, entry] of caseEntries) {
    cases[id] = parsedBySource.get(entry.source);
  }
  for (const [id, entry] of storyEntries) {
    stories[id] = parsedBySource.get(entry.source);
  }

  const progression = parsedBySource.get("progression.json");
  const progressionRecord = isRecord(progression) ? progression : undefined;
  if (progressionRecord) {
    for (const key of Object.keys(progressionRecord)) {
      if (key !== "unlockRules" && key !== "storyRules") {
        issues.push(
          packageIssue(
            "CONTENT_SCHEMA_INVALID",
            completeRoots["progression.json"].source,
            "progression",
            `Unrecognized key "${key}" in progression.json.`,
            [key],
          ),
        );
      }
    }
  }

  const candidate = {
    manifest: parsedBySource.get("manifest.json"),
    attributes: parsedBySource.get("attributes.json"),
    initial: parsedBySource.get("initial.json"),
    cases,
    unlockRules: progressionRecord?.unlockRules,
    storyRules: progressionRecord?.storyRules,
    stories,
    endings: parsedBySource.get("endings.json"),
    assets: parsedBySource.get("assets.json"),
  };
  const validation = validateContentCatalog(candidate, {
    fileInventory: options.fileInventory,
    expectedPackageId: options.expectedPackageId,
    expectedVersion: options.expectedVersion,
  });
  if (!validation.ok) {
    issues.push(...remapCatalogIssues(validation.issues, sourceMap));
  }

  if (issues.length > 0 || !validation.ok) {
    return { ok: false, issues: sortContentValidationIssues(issues) };
  }

  return {
    ok: true,
    catalog: validation.catalog,
    sourceMap,
    issues: [],
  };
};
