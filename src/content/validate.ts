import { ContentCatalogSchema, type Condition, type ContentCatalog } from "./schema";
import { collectCaseGraphIssues } from "./validateCaseGraph";

export type ContentValidationIssueCode =
  | "CONTENT_SCHEMA_INVALID"
  | "CASE_KEY_ID_MISMATCH"
  | "CHOICE_ID_DUPLICATE"
  | "INITIAL_CASE_ID_DUPLICATE"
  | "INITIAL_STORY_ID_DUPLICATE"
  | "CASE_REFERENCE_INVALID"
  | "NODE_REFERENCE_INVALID"
  | "RESOLUTION_REFERENCE_INVALID"
  | "ATTRIBUTE_REFERENCE_INVALID"
  | "FLAG_REFERENCE_INVALID"
  | "STORY_REFERENCE_INVALID"
  | "UNLOCK_RULE_ID_DUPLICATE"
  | "STORY_RULE_ID_DUPLICATE"
  | "ENDING_PRIORITY_DUPLICATE"
  | "ENDING_STORY_ID_DUPLICATE"
  | "ENDING_STORY_IN_INITIAL"
  | "ENDING_STORY_IN_STORY_RULE"
  | "CASE_NODE_UNREACHABLE"
  | "CASE_GRAPH_CYCLE"
  | "CASE_PATH_NON_TERMINATING"
  | "CONTENT_PACKAGE_FILE_MISSING"
  | "CONTENT_PACKAGE_FILE_DUPLICATE"
  | "CONTENT_PACKAGE_JSON_INVALID"
  | "CONTENT_PACKAGE_FILE_UNRECOGNIZED"
  | "ASSET_PATH_INVALID"
  | "ASSET_REFERENCE_INVALID"
  | "ASSET_KIND_INVALID"
  | "ASSET_FILE_MISSING"
  | "MANIFEST_PACKAGE_ID_MISMATCH"
  | "MANIFEST_VERSION_MISMATCH";

export type ContentValidationPath = readonly (string | number)[];

/** Stable diagnostic shape shared by build-time, CLI, and runtime validation. */
export interface ContentValidationIssue {
  readonly code: ContentValidationIssueCode;
  readonly source: string;
  readonly objectId: string;
  readonly path: ContentValidationPath;
  readonly message: string;
}

export interface ContentValidationOptions {
  /** Logical source used until the package loader supplies per-file source mapping in C3. */
  readonly source?: string;
  /** Package-relative file inventory. Omit when physical files are intentionally unavailable. */
  readonly fileInventory?: readonly string[];
  /** Expected identity derived by a future adapter from the physical package directory. */
  readonly expectedPackageId?: string;
  readonly expectedVersion?: string;
}

export type ContentValidationResult =
  | {
      readonly ok: true;
      readonly catalog: Readonly<ContentCatalog>;
      readonly issues: readonly [];
    }
  | {
      readonly ok: false;
      readonly issues: readonly ContentValidationIssue[];
    };

type IssueCollector = (
  code: ContentValidationIssueCode,
  objectId: string,
  path: ContentValidationPath,
  message: string,
) => void;

const DEFAULT_SOURCE = "<catalog>";

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const comparePaths = (left: ContentValidationPath, right: ContentValidationPath): number => {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftSegment = left[index];
    const rightSegment = right[index];
    if (leftSegment === rightSegment) {
      continue;
    }
    if (typeof leftSegment === "number" && typeof rightSegment === "number") {
      return leftSegment - rightSegment;
    }
    return compareStrings(String(leftSegment), String(rightSegment));
  }
  return left.length - right.length;
};

/** @internal Shared stable ordering for pure package and catalog validation. */
export const sortContentValidationIssues = (
  issues: readonly ContentValidationIssue[],
): readonly ContentValidationIssue[] =>
  [...issues].sort(
    (left, right) =>
      compareStrings(left.source, right.source) ||
      comparePaths(left.path, right.path) ||
      compareStrings(left.code, right.code) ||
      compareStrings(left.objectId, right.objectId) ||
      compareStrings(left.message, right.message),
  );

const sortedKeys = <T>(record: Readonly<Record<string, T>>): string[] =>
  Object.keys(record).sort(compareStrings);

const normalizePath = (path: readonly PropertyKey[]): ContentValidationPath =>
  path.map((segment) =>
    typeof segment === "symbol" ? (segment.description ?? String(segment)) : segment,
  );

/**
 * Structural errors may occur before object parsing is safe. Derive only conservative IDs
 * from the path/raw input and always fall back to a stable catalog-level identifier.
 */
const objectIdForSchemaIssue = (input: unknown, path: ContentValidationPath): string => {
  const [collection, member] = path;
  if (
    typeof collection === "string" &&
    typeof member === "string" &&
    ["attributes", "cases", "stories", "endings", "assets"].includes(collection)
  ) {
    return member;
  }
  if (collection === "initial" || collection === "manifest") {
    return collection;
  }
  if ((collection === "unlockRules" || collection === "storyRules") && typeof member === "number") {
    try {
      if (typeof input === "object" && input !== null) {
        const rules = (input as Record<string, unknown>)[collection];
        if (Array.isArray(rules)) {
          const rule = rules[member];
          if (typeof rule === "object" && rule !== null) {
            const id = (rule as Record<string, unknown>).id;
            if (typeof id === "string" && id.length > 0) {
              return id;
            }
          }
        }
      }
    } catch {
      // A hostile accessor must not turn a validation failure into an exception.
    }
    return `${collection}[${member}]`;
  }
  return "catalog";
};

const checkConditionReferences = (
  condition: Condition,
  basePath: ContentValidationPath,
  objectId: string,
  content: Readonly<ContentCatalog>,
  addIssue: IssueCollector,
): void => {
  condition.all.forEach((predicate, predicateIndex) => {
    const predicatePath = [...basePath, "all", predicateIndex] as const;

    switch (predicate.type) {
      case "caseResolved": {
        if (!Object.hasOwn(content.cases, predicate.caseId)) {
          addIssue(
            "CASE_REFERENCE_INVALID",
            objectId,
            [...predicatePath, "caseId"],
            `Predicate references unknown case "${predicate.caseId}".`,
          );
          break;
        }

        const definition = content.cases[predicate.caseId];
        if (
          predicate.resolutionId !== undefined &&
          !Object.hasOwn(definition.resolutions, predicate.resolutionId)
        ) {
          addIssue(
            "RESOLUTION_REFERENCE_INVALID",
            objectId,
            [...predicatePath, "resolutionId"],
            `Predicate references unknown resolution "${predicate.resolutionId}" for case "${predicate.caseId}".`,
          );
        }
        break;
      }
      case "attributeAtLeast":
      case "attributeAtMost":
        if (!Object.hasOwn(content.attributes, predicate.attributeId)) {
          addIssue(
            "ATTRIBUTE_REFERENCE_INVALID",
            objectId,
            [...predicatePath, "attributeId"],
            `Predicate references unknown attribute "${predicate.attributeId}".`,
          );
        }
        break;
      case "flagEquals":
        if (!Object.hasOwn(content.initial.flags, predicate.flagId)) {
          addIssue(
            "FLAG_REFERENCE_INVALID",
            objectId,
            [...predicatePath, "flagId"],
            `Predicate references unknown flag "${predicate.flagId}".`,
          );
        }
        break;
      case "resolvedCountAtLeast":
        break;
    }
  });
};

const checkInitialReferences = (
  content: Readonly<ContentCatalog>,
  addIssue: IssueCollector,
): void => {
  const seenCaseIds = new Set<string>();
  content.initial.caseIds.forEach((caseId, index) => {
    if (seenCaseIds.has(caseId)) {
      addIssue(
        "INITIAL_CASE_ID_DUPLICATE",
        "initial",
        ["initial", "caseIds", index],
        `Initial case "${caseId}" is listed more than once.`,
      );
    }
    seenCaseIds.add(caseId);
    if (!Object.hasOwn(content.cases, caseId)) {
      addIssue(
        "CASE_REFERENCE_INVALID",
        "initial",
        ["initial", "caseIds", index],
        `Initial content references unknown case "${caseId}".`,
      );
    }
  });

  const seenStoryIds = new Set<string>();
  content.initial.storyIds.forEach((storyId, index) => {
    if (seenStoryIds.has(storyId)) {
      addIssue(
        "INITIAL_STORY_ID_DUPLICATE",
        "initial",
        ["initial", "storyIds", index],
        `Initial story "${storyId}" is listed more than once.`,
      );
    }
    seenStoryIds.add(storyId);
    if (!Object.hasOwn(content.stories, storyId)) {
      addIssue(
        "STORY_REFERENCE_INVALID",
        "initial",
        ["initial", "storyIds", index],
        `Initial content references unknown story "${storyId}".`,
      );
    }
  });
};

const checkCaseReferences = (content: Readonly<ContentCatalog>, addIssue: IssueCollector): void => {
  for (const caseId of sortedKeys(content.cases)) {
    const definition = content.cases[caseId];
    const casePath = ["cases", caseId] as const;

    if (definition.id !== caseId) {
      addIssue(
        "CASE_KEY_ID_MISMATCH",
        caseId,
        [...casePath, "id"],
        `Case record key "${caseId}" does not match definition id "${definition.id}".`,
      );
    }
    if (!Object.hasOwn(definition.nodes, definition.startNodeId)) {
      addIssue(
        "NODE_REFERENCE_INVALID",
        caseId,
        [...casePath, "startNodeId"],
        `Case "${caseId}" starts at unknown node "${definition.startNodeId}".`,
      );
    }

    const choicesById = new Map<string, string>();
    for (const nodeId of sortedKeys(definition.nodes)) {
      const node = definition.nodes[nodeId];
      node.choices.forEach((choice, choiceIndex) => {
        const choicePath = [...casePath, "nodes", nodeId, "choices", choiceIndex] as const;
        const previousNodeId = choicesById.get(choice.id);
        if (previousNodeId !== undefined) {
          addIssue(
            "CHOICE_ID_DUPLICATE",
            caseId,
            [...choicePath, "id"],
            `Choice id "${choice.id}" is already used in node "${previousNodeId}" of case "${caseId}".`,
          );
        } else {
          choicesById.set(choice.id, nodeId);
        }

        if (
          choice.target.type === "node" &&
          !Object.hasOwn(definition.nodes, choice.target.nodeId)
        ) {
          addIssue(
            "NODE_REFERENCE_INVALID",
            caseId,
            [...choicePath, "target", "nodeId"],
            `Choice "${choice.id}" references unknown node "${choice.target.nodeId}" in case "${caseId}".`,
          );
        } else if (
          choice.target.type === "resolution" &&
          !Object.hasOwn(definition.resolutions, choice.target.resolutionId)
        ) {
          addIssue(
            "RESOLUTION_REFERENCE_INVALID",
            caseId,
            [...choicePath, "target", "resolutionId"],
            `Choice "${choice.id}" references unknown resolution "${choice.target.resolutionId}" in case "${caseId}".`,
          );
        }
      });
    }

    for (const resolutionId of sortedKeys(definition.resolutions)) {
      const resolution = definition.resolutions[resolutionId];
      const effectsPath = [...casePath, "resolutions", resolutionId, "effects"] as const;
      for (const attributeId of sortedKeys(resolution.effects.attributeDeltas)) {
        if (!Object.hasOwn(content.attributes, attributeId)) {
          addIssue(
            "ATTRIBUTE_REFERENCE_INVALID",
            caseId,
            [...effectsPath, "attributeDeltas", attributeId],
            `Resolution "${resolutionId}" references unknown attribute "${attributeId}".`,
          );
        }
      }
      for (const flagId of sortedKeys(resolution.effects.setFlags)) {
        if (!Object.hasOwn(content.initial.flags, flagId)) {
          addIssue(
            "FLAG_REFERENCE_INVALID",
            caseId,
            [...effectsPath, "setFlags", flagId],
            `Resolution "${resolutionId}" references unknown flag "${flagId}".`,
          );
        }
      }
    }
  }
};

const checkRuleIds = (
  rules: readonly { readonly id: string }[],
  collection: "unlockRules" | "storyRules",
  duplicateCode: "UNLOCK_RULE_ID_DUPLICATE" | "STORY_RULE_ID_DUPLICATE",
  addIssue: IssueCollector,
): void => {
  const firstIndexById = new Map<string, number>();
  rules.forEach((rule, index) => {
    const firstIndex = firstIndexById.get(rule.id);
    if (firstIndex !== undefined) {
      addIssue(
        duplicateCode,
        rule.id,
        [collection, index, "id"],
        `Rule id "${rule.id}" duplicates ${collection}[${firstIndex}].`,
      );
    } else {
      firstIndexById.set(rule.id, index);
    }
  });
};

const checkProgressionReferences = (
  content: Readonly<ContentCatalog>,
  addIssue: IssueCollector,
): void => {
  checkRuleIds(content.unlockRules, "unlockRules", "UNLOCK_RULE_ID_DUPLICATE", addIssue);
  checkRuleIds(content.storyRules, "storyRules", "STORY_RULE_ID_DUPLICATE", addIssue);

  content.unlockRules.forEach((rule, ruleIndex) => {
    const rulePath = ["unlockRules", ruleIndex] as const;
    checkConditionReferences(rule.when, [...rulePath, "when"], rule.id, content, addIssue);
    rule.caseIds.forEach((caseId, caseIndex) => {
      if (!Object.hasOwn(content.cases, caseId)) {
        addIssue(
          "CASE_REFERENCE_INVALID",
          rule.id,
          [...rulePath, "caseIds", caseIndex],
          `Unlock rule "${rule.id}" references unknown case "${caseId}".`,
        );
      }
    });
  });

  content.storyRules.forEach((rule, ruleIndex) => {
    const rulePath = ["storyRules", ruleIndex] as const;
    checkConditionReferences(rule.when, [...rulePath, "when"], rule.id, content, addIssue);
    if (!Object.hasOwn(content.stories, rule.storyId)) {
      addIssue(
        "STORY_REFERENCE_INVALID",
        rule.id,
        [...rulePath, "storyId"],
        `Story rule "${rule.id}" references unknown story "${rule.storyId}".`,
      );
    }
  });
};

const checkEndingReferences = (
  content: Readonly<ContentCatalog>,
  addIssue: IssueCollector,
): void => {
  const firstEndingByPriority = new Map<number, string>();
  const firstEndingByStoryId = new Map<string, string>();
  const endingStoryIds = new Set<string>();

  for (const endingId of sortedKeys(content.endings)) {
    const ending = content.endings[endingId];
    const endingPath = ["endings", endingId] as const;
    endingStoryIds.add(ending.storyId);
    checkConditionReferences(ending.when, [...endingPath, "when"], endingId, content, addIssue);

    if (!Object.hasOwn(content.stories, ending.storyId)) {
      addIssue(
        "STORY_REFERENCE_INVALID",
        endingId,
        [...endingPath, "storyId"],
        `Ending "${endingId}" references unknown story "${ending.storyId}".`,
      );
    }

    const priorityOwner = firstEndingByPriority.get(ending.priority);
    if (priorityOwner !== undefined) {
      addIssue(
        "ENDING_PRIORITY_DUPLICATE",
        endingId,
        [...endingPath, "priority"],
        `Ending priority ${ending.priority} is already used by ending "${priorityOwner}".`,
      );
    } else {
      firstEndingByPriority.set(ending.priority, endingId);
    }

    const storyOwner = firstEndingByStoryId.get(ending.storyId);
    if (storyOwner !== undefined) {
      addIssue(
        "ENDING_STORY_ID_DUPLICATE",
        endingId,
        [...endingPath, "storyId"],
        `Ending story "${ending.storyId}" is already used by ending "${storyOwner}".`,
      );
    } else {
      firstEndingByStoryId.set(ending.storyId, endingId);
    }
  }

  content.initial.storyIds.forEach((storyId, storyIndex) => {
    if (endingStoryIds.has(storyId)) {
      addIssue(
        "ENDING_STORY_IN_INITIAL",
        "initial",
        ["initial", "storyIds", storyIndex],
        `Ending story "${storyId}" cannot be queued as an initial story.`,
      );
    }
  });

  content.storyRules.forEach((rule, ruleIndex) => {
    if (endingStoryIds.has(rule.storyId)) {
      addIssue(
        "ENDING_STORY_IN_STORY_RULE",
        rule.id,
        ["storyRules", ruleIndex, "storyId"],
        `Ending story "${rule.storyId}" cannot be targeted by a normal story rule.`,
      );
    }
  });
};

const assetPathProblem = (path: string): string | undefined => {
  if (/^[A-Za-z][A-Za-z\d+.-]*:/u.test(path) || path.includes("://")) {
    return "URL-like and drive-prefixed paths are not allowed";
  }
  if (path.startsWith("/") || path.includes("\\")) {
    return "absolute paths and backslashes are not allowed";
  }
  if (/\p{Cc}/u.test(path)) {
    return "control characters are not allowed";
  }
  if (path.includes("?") || path.includes("#")) {
    return "query strings and fragments are not allowed";
  }

  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0)) {
    return "empty path segments are not allowed";
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return '"." and ".." path segments are not allowed';
  }
  return undefined;
};

const checkAssets = (
  content: Readonly<ContentCatalog>,
  options: ContentValidationOptions,
  addIssue: IssueCollector,
): void => {
  const inventory =
    options.fileInventory === undefined ? undefined : new Set(options.fileInventory);

  for (const assetId of sortedKeys(content.assets)) {
    const asset = content.assets[assetId];
    const path = ["assets", assetId, "path"] as const;
    const problem = assetPathProblem(asset.path);
    if (problem !== undefined) {
      addIssue(
        "ASSET_PATH_INVALID",
        assetId,
        path,
        `Asset "${assetId}" path "${asset.path}" is invalid: ${problem}.`,
      );
    } else if (inventory !== undefined && !inventory.has(asset.path)) {
      addIssue(
        "ASSET_FILE_MISSING",
        assetId,
        path,
        `Asset "${assetId}" references missing package file "${asset.path}".`,
      );
    }
  }

  for (const storyId of sortedKeys(content.stories)) {
    const story = content.stories[storyId];
    story.steps.forEach((step, stepIndex) => {
      if (step.type !== "video") {
        return;
      }
      const path = ["stories", storyId, "steps", stepIndex, "assetId"] as const;
      if (!Object.hasOwn(content.assets, step.assetId)) {
        addIssue(
          "ASSET_REFERENCE_INVALID",
          storyId,
          path,
          `Video step references unknown asset "${step.assetId}".`,
        );
      } else if (content.assets[step.assetId].kind !== "video") {
        addIssue(
          "ASSET_KIND_INVALID",
          storyId,
          path,
          `Video step asset "${step.assetId}" must have kind "video", not "${content.assets[step.assetId].kind}".`,
        );
      }
    });
  }
};

const checkExpectedManifestIdentity = (
  content: Readonly<ContentCatalog>,
  options: ContentValidationOptions,
  addIssue: IssueCollector,
): void => {
  if (
    options.expectedPackageId !== undefined &&
    content.manifest.packageId !== options.expectedPackageId
  ) {
    addIssue(
      "MANIFEST_PACKAGE_ID_MISMATCH",
      "manifest",
      ["manifest", "packageId"],
      `Manifest packageId "${content.manifest.packageId}" does not match expected packageId "${options.expectedPackageId}".`,
    );
  }
  if (
    options.expectedVersion !== undefined &&
    content.manifest.version !== options.expectedVersion
  ) {
    addIssue(
      "MANIFEST_VERSION_MISMATCH",
      "manifest",
      ["manifest", "version"],
      `Manifest version "${content.manifest.version}" does not match expected version "${options.expectedVersion}".`,
    );
  }
};

/**
 * Validates an unknown value without mutating it or throwing for malformed content.
 * Asset references and paths are checked here; physical existence is checked only when an
 * inventory is supplied. Package layout and filesystem discovery remain adapter responsibilities.
 */
export const validateContentCatalog = (
  input: unknown,
  options: ContentValidationOptions = {},
): ContentValidationResult => {
  const source = options.source ?? DEFAULT_SOURCE;
  let parsed: ReturnType<typeof ContentCatalogSchema.safeParse>;
  try {
    parsed = ContentCatalogSchema.safeParse(input);
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "CONTENT_SCHEMA_INVALID",
          source,
          objectId: "catalog",
          path: [],
          message: "Content schema validation failed unexpectedly.",
        },
      ],
    };
  }

  if (!parsed.success) {
    return {
      ok: false,
      issues: sortContentValidationIssues(
        parsed.error.issues.map((issue) => {
          const path = normalizePath(issue.path);
          return {
            code: "CONTENT_SCHEMA_INVALID" as const,
            source,
            objectId: objectIdForSchemaIssue(input, path),
            path,
            message: issue.message,
          };
        }),
      ),
    };
  }

  const content = parsed.data;
  const issues: ContentValidationIssue[] = [];
  const addIssue: IssueCollector = (code, objectId, path, message) => {
    issues.push({ code, source, objectId, path: [...path], message });
  };

  checkInitialReferences(content, addIssue);
  checkCaseReferences(content, addIssue);
  checkProgressionReferences(content, addIssue);
  checkEndingReferences(content, addIssue);
  checkAssets(content, options, addIssue);
  checkExpectedManifestIdentity(content, options, addIssue);
  for (const issue of collectCaseGraphIssues(content)) {
    addIssue(issue.code, issue.objectId, issue.path, issue.message);
  }

  return issues.length === 0
    ? { ok: true, catalog: content, issues: [] }
    : { ok: false, issues: sortContentValidationIssues(issues) };
};
