import {
  GameContentCatalogSchema,
  LocalizedContentCatalogSchema,
  type Condition,
  type ContentLocale,
  type GameContentCatalog,
  type LocalizedContentCatalog,
} from "./schema";
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
  | "MANIFEST_VERSION_MISMATCH"
  | "GAME_CONTENT_SCHEMA_INVALID"
  | "STORY_STEP_ID_DUPLICATE"
  | "STORY_INPUT_SKIPPABLE"
  | "LOCALIZATION_SCHEMA_INVALID"
  | "LOCALIZATION_PACKAGE_ID_MISMATCH"
  | "LOCALIZATION_VERSION_MISMATCH"
  | "LOCALIZATION_LOCALE_UNSUPPORTED"
  | "LOCALIZATION_LOCALE_MISMATCH"
  | "LOCALIZATION_ID_MISSING"
  | "LOCALIZATION_ID_EXTRA"
  | "LOCALIZATION_ANNOTATION_MISMATCH"
  | "NARRATION_VERSION_UNSUPPORTED"
  | "NARRATION_TEXT_MISSING"
  | "NARRATION_TEXT_UNUSED";

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

export type GameContentValidationResult =
  | {
      readonly ok: true;
      readonly catalog: Readonly<GameContentCatalog>;
      readonly issues: readonly [];
    }
  | { readonly ok: false; readonly issues: readonly ContentValidationIssue[] };

export interface LocalizationValidationOptions {
  readonly source?: string;
  readonly expectedLocale?: ContentLocale;
}

export type LocalizationValidationResult =
  | {
      readonly ok: true;
      readonly catalog: Readonly<LocalizedContentCatalog>;
      readonly issues: readonly [];
    }
  | { readonly ok: false; readonly issues: readonly ContentValidationIssue[] };

type IssueCollector = (
  code: ContentValidationIssueCode,
  objectId: string,
  path: ContentValidationPath,
  message: string,
) => void;

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
  content: Readonly<GameContentCatalog>,
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
  content: Readonly<GameContentCatalog>,
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

const checkCaseReferences = (
  content: Readonly<GameContentCatalog>,
  addIssue: IssueCollector,
): void => {
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
  content: Readonly<GameContentCatalog>,
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
  content: Readonly<GameContentCatalog>,
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
  content: Readonly<GameContentCatalog>,
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
  content: Readonly<GameContentCatalog>,
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

/** Validates the schema-v2 rules catalog without requiring presentation data. */
export const validateGameContentCatalog = (
  input: unknown,
  options: ContentValidationOptions = {},
): GameContentValidationResult => {
  const source = options.source ?? "<game-content>";
  let parsed: ReturnType<typeof GameContentCatalogSchema.safeParse>;
  try {
    parsed = GameContentCatalogSchema.safeParse(input);
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "GAME_CONTENT_SCHEMA_INVALID",
          source,
          objectId: "catalog",
          path: [],
          message: "Game content schema validation failed unexpectedly.",
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
            code: "GAME_CONTENT_SCHEMA_INVALID" as const,
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

  for (const [storyId, story] of Object.entries(content.stories)) {
    const firstIndexById = new Map<string, number>();
    if (story.skippable && story.steps.some((step) => step.type === "actionInput")) {
      addIssue(
        "STORY_INPUT_SKIPPABLE",
        storyId,
        ["stories", storyId, "skippable"],
        "Stories with action inputs cannot be skippable.",
      );
    }
    story.steps.forEach((step, index) => {
      if (step.type === "actionInput") {
        const base = ["stories", storyId, "steps", index] as const;
        for (const id of Object.keys(step.wrongEffects?.attributeDeltas ?? {})) {
          if (!Object.hasOwn(content.attributes, id))
            addIssue(
              "ATTRIBUTE_REFERENCE_INVALID",
              storyId,
              [...base, "wrongEffects", "attributeDeltas", id],
              `Unknown attribute "${id}".`,
            );
        }
        for (const id of Object.keys(step.wrongEffects?.setFlags ?? {})) {
          if (!Object.hasOwn(content.initial.flags, id))
            addIssue(
              "FLAG_REFERENCE_INVALID",
              storyId,
              [...base, "wrongEffects", "setFlags", id],
              `Unknown flag "${id}".`,
            );
        }
      }
      const firstIndex = firstIndexById.get(step.id);
      if (firstIndex === undefined) {
        firstIndexById.set(step.id, index);
      } else {
        addIssue(
          "STORY_STEP_ID_DUPLICATE",
          storyId,
          ["stories", storyId, "steps", index, "id"],
          `Story step id "${step.id}" duplicates steps[${firstIndex}].`,
        );
      }
    });
  }

  return issues.length === 0
    ? { ok: true, catalog: content, issues: [] }
    : { ok: false, issues: sortContentValidationIssues(issues) };
};

const checkExactLocalizationIds = (
  expected: readonly string[],
  actual: Readonly<Record<string, unknown>>,
  basePath: ContentValidationPath,
  objectId: string,
  addIssue: IssueCollector,
): void => {
  const expectedSet = new Set(expected);
  for (const id of [...expectedSet].sort(compareStrings)) {
    if (!Object.hasOwn(actual, id)) {
      addIssue(
        "LOCALIZATION_ID_MISSING",
        objectId,
        [...basePath, id],
        `Localized catalog is missing id "${id}".`,
      );
    }
  }
  for (const id of Object.keys(actual).sort(compareStrings)) {
    if (!expectedSet.has(id)) {
      addIssue(
        "LOCALIZATION_ID_EXTRA",
        objectId,
        [...basePath, id],
        `Localized catalog contains unknown id "${id}".`,
      );
    }
  }
};

/**
 * Validates locale identity and exact display coverage against one rules catalog.
 * Strict Zod objects reject business fields before any coverage comparison runs.
 */
export const validateLocalizedContentCatalog = (
  input: unknown,
  gameContent: Readonly<GameContentCatalog>,
  options: LocalizationValidationOptions = {},
): LocalizationValidationResult => {
  const source = options.source ?? "<localization>";
  const parsed = LocalizedContentCatalogSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: sortContentValidationIssues(
        parsed.error.issues.map((issue) => {
          const path = normalizePath(issue.path);
          return {
            code: "LOCALIZATION_SCHEMA_INVALID" as const,
            source,
            objectId: objectIdForSchemaIssue(input, path),
            path,
            message: issue.message,
          };
        }),
      ),
    };
  }

  const localized = parsed.data;
  const issues: ContentValidationIssue[] = [];
  const addIssue: IssueCollector = (code, objectId, path, message) => {
    issues.push({ code, source, objectId, path: [...path], message });
  };

  // Localizations inherit the rules package version; even orphan entries cannot add v4 fields.
  if (gameContent.manifest.contentSchemaVersion < 4) {
    for (const [storyId, story] of Object.entries(localized.stories)) {
      for (const [stepId, step] of Object.entries(story.steps)) {
        if (step.narrationText !== undefined) {
          addIssue(
            "NARRATION_VERSION_UNSUPPORTED",
            storyId,
            ["stories", storyId, "steps", stepId, "narrationText"],
            "narrationText requires content schema v4.",
          );
        }
      }
    }
  }

  if (localized.packageId !== gameContent.manifest.packageId) {
    addIssue(
      "LOCALIZATION_PACKAGE_ID_MISMATCH",
      "localization",
      ["packageId"],
      `Localized packageId "${localized.packageId}" does not match "${gameContent.manifest.packageId}".`,
    );
  }
  if (localized.version !== gameContent.manifest.version) {
    addIssue(
      "LOCALIZATION_VERSION_MISMATCH",
      "localization",
      ["version"],
      `Localized version "${localized.version}" does not match "${gameContent.manifest.version}".`,
    );
  }
  if (!gameContent.manifest.supportedLocales.includes(localized.locale)) {
    addIssue(
      "LOCALIZATION_LOCALE_UNSUPPORTED",
      "localization",
      ["locale"],
      `Locale "${localized.locale}" is not declared by the game content manifest.`,
    );
  }
  if (options.expectedLocale !== undefined && localized.locale !== options.expectedLocale) {
    addIssue(
      "LOCALIZATION_LOCALE_MISMATCH",
      "localization",
      ["locale"],
      `Localized locale "${localized.locale}" does not match requested locale "${options.expectedLocale}".`,
    );
  }

  checkExactLocalizationIds(
    Object.keys(gameContent.attributes),
    localized.attributes,
    ["attributes"],
    "attributes",
    addIssue,
  );
  checkExactLocalizationIds(
    Object.keys(gameContent.cases),
    localized.cases,
    ["cases"],
    "cases",
    addIssue,
  );
  checkExactLocalizationIds(
    Object.keys(gameContent.stories),
    localized.stories,
    ["stories"],
    "stories",
    addIssue,
  );
  checkExactLocalizationIds(
    Object.keys(gameContent.endings),
    localized.endings,
    ["endings"],
    "endings",
    addIssue,
  );

  for (const [caseId, definition] of Object.entries(gameContent.cases)) {
    const copy = localized.cases[caseId];
    if (!copy) continue;
    checkExactLocalizationIds(
      definition.characters.map(({ id }) => id),
      copy.characters,
      ["cases", caseId, "characters"],
      caseId,
      addIssue,
    );
    checkExactLocalizationIds(
      Object.keys(definition.nodes),
      copy.nodes,
      ["cases", caseId, "nodes"],
      caseId,
      addIssue,
    );
    checkExactLocalizationIds(
      Object.keys(definition.resolutions),
      copy.resolutions,
      ["cases", caseId, "resolutions"],
      caseId,
      addIssue,
    );
    const choices = Object.values(definition.nodes).flatMap((node) => node.choices);
    checkExactLocalizationIds(
      choices.map(({ id }) => id),
      copy.choices,
      ["cases", caseId, "choices"],
      caseId,
      addIssue,
    );
    for (const choice of choices) {
      const localizedChoice = copy.choices[choice.id];
      if (!localizedChoice) continue;
      if (choice.hasAnnotation !== (localizedChoice.annotation !== undefined)) {
        addIssue(
          "LOCALIZATION_ANNOTATION_MISMATCH",
          caseId,
          ["cases", caseId, "choices", choice.id, "annotation"],
          `Choice "${choice.id}" annotation presence does not match the rules catalog.`,
        );
      }
    }
  }

  for (const [storyId, story] of Object.entries(gameContent.stories)) {
    const copy = localized.stories[storyId];
    if (!copy) continue;
    checkExactLocalizationIds(
      story.steps.filter((step) => step.type !== "effect").map(({ id }) => id),
      copy.steps,
      ["stories", storyId, "steps"],
      storyId,
      addIssue,
    );
    for (const step of story.steps) {
      const localizedStep = copy.steps[step.id];
      if (!localizedStep) continue;
      const narration =
        step.type === "text" || step.type === "actionInput" ? step.narration : undefined;
      const dedicated = narration?.textSource === "narrationText";
      const path = ["stories", storyId, "steps", step.id];
      if (!dedicated && localizedStep.narrationText !== undefined) {
        addIssue(
          "NARRATION_TEXT_UNUSED",
          storyId,
          [...path, "narrationText"],
          "narrationText must be explicitly referenced by this step.",
        );
      }
      if (narration !== undefined) {
        const text = dedicated
          ? localizedStep.narrationText?.trim()
          : localizedStep.blocks
              .map((block) => block.text.trim())
              .filter(Boolean)
              .join("\n");
        if (!text) {
          addIssue(
            "NARRATION_TEXT_MISSING",
            storyId,
            [...path, dedicated ? "narrationText" : "blocks"],
            "Narration requires non-blank localized text.",
          );
        }
      }
    }
  }

  return issues.length === 0
    ? { ok: true, catalog: localized, issues: [] }
    : { ok: false, issues: sortContentValidationIssues(issues) };
};
