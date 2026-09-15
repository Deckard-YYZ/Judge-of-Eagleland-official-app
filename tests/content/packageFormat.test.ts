import { describe, expect, it } from "vitest";

import { MINIMAL_CATALOG } from "../../src/content/fixtures/minimalCatalog";
import { loadContentPackage, type ContentPackageSource } from "../../src/content/packageFormat";
import type { ContentCatalog } from "../../src/content/schema";

const cloneCatalog = (): ContentCatalog => structuredClone(MINIMAL_CATALOG);

const packageSources = (catalog = cloneCatalog()): ContentPackageSource[] => [
  { source: "manifest.json", text: JSON.stringify(catalog.manifest) },
  { source: "attributes.json", text: JSON.stringify(catalog.attributes) },
  { source: "initial.json", text: JSON.stringify(catalog.initial) },
  {
    source: "progression.json",
    text: JSON.stringify({
      unlockRules: catalog.unlockRules,
      storyRules: catalog.storyRules,
    }),
  },
  { source: "endings.json", text: JSON.stringify(catalog.endings) },
  { source: "assets.json", text: JSON.stringify(catalog.assets) },
  ...Object.entries(catalog.cases).map(([id, definition]) => ({
    source: `cases/${id}.json`,
    text: JSON.stringify(definition),
  })),
  ...Object.entries(catalog.stories).map(([id, definition]) => ({
    source: `stories/${id}.json`,
    text: JSON.stringify(definition),
  })),
];

const replaceJson = (
  sources: ContentPackageSource[],
  source: string,
  mutate: (value: any) => void,
): void => {
  const index = sources.findIndex((entry) => entry.source === source);
  if (index < 0) {
    throw new Error(`Missing test source ${source}.`);
  }
  const value = JSON.parse(sources[index].text) as unknown;
  mutate(value);
  sources[index] = { source, text: JSON.stringify(value) };
};

const failureIssues = (sources: readonly ContentPackageSource[]) => {
  const result = loadContentPackage(sources);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected package loading to fail.");
  }
  return result.issues;
};

describe("loadContentPackage", () => {
  it("assembles a valid package without depending on input order or mutating sources", () => {
    const sources = packageSources().reverse();
    const before = structuredClone(sources);

    const result = loadContentPackage(sources);

    expect(result.ok).toBe(true);
    expect(sources).toEqual(before);
    if (!result.ok) {
      return;
    }
    expect(result.catalog).toEqual(MINIMAL_CATALOG);
    expect(result.sourceMap.sourceForPath(["manifest", "title"])).toBe("manifest.json");
    expect(result.sourceMap.sourceForPath(["cases", "case_001", "nodes"])).toBe(
      "cases/case_001.json",
    );
    expect(result.sourceMap.sourceForPath(["stories", "ending_balanced", "steps"])).toBe(
      "stories/ending_balanced.json",
    );
    expect(result.sourceMap.sourceForPath(["storyRules", 0, "storyId"])).toBe("progression.json");
    expect(Object.isFrozen(result.sourceMap)).toBe(true);
    expect(Object.isFrozen(result.sourceMap.cases)).toBe(true);
    expect(Object.isFrozen(result.sourceMap.stories)).toBe(true);
  });

  it("reports every missing required root file in stable source order", () => {
    const sources = packageSources().filter(
      (entry) => entry.source !== "initial.json" && entry.source !== "assets.json",
    );

    const issues = failureIssues(sources);

    expect(
      issues.map(({ code, source, objectId, path }) => ({ code, source, objectId, path })),
    ).toEqual([
      {
        code: "CONTENT_PACKAGE_FILE_MISSING",
        source: "assets.json",
        objectId: "assets",
        path: [],
      },
      {
        code: "CONTENT_PACKAGE_FILE_MISSING",
        source: "initial.json",
        objectId: "initial",
        path: [],
      },
    ]);
  });

  it("rejects duplicate root and object paths instead of selecting an overwrite winner", () => {
    const sources = packageSources();
    const manifest = sources.find((entry) => entry.source === "manifest.json")!;
    const caseFile = sources.find((entry) => entry.source === "cases/case_001.json")!;
    sources.push({ ...manifest }, { ...caseFile });

    const issues = failureIssues(sources);

    expect(issues.map(({ code, source, objectId }) => ({ code, source, objectId }))).toEqual([
      {
        code: "CONTENT_PACKAGE_FILE_DUPLICATE",
        source: "cases/case_001.json",
        objectId: "case_001",
      },
      {
        code: "CONTENT_PACKAGE_FILE_DUPLICATE",
        source: "manifest.json",
        objectId: "manifest",
      },
    ]);
    expect(loadContentPackage(sources)).not.toHaveProperty("catalog");
  });

  it("reports malformed JSON for each independently parseable package file", () => {
    const sources = packageSources();
    const caseIndex = sources.findIndex((entry) => entry.source === "cases/case_002.json");
    const progressionIndex = sources.findIndex((entry) => entry.source === "progression.json");
    sources[caseIndex] = { source: "cases/case_002.json", text: "{" };
    sources[progressionIndex] = { source: "progression.json", text: "[" };

    expect(
      failureIssues(sources).map(({ code, source, objectId }) => ({ code, source, objectId })),
    ).toEqual([
      {
        code: "CONTENT_PACKAGE_JSON_INVALID",
        source: "cases/case_002.json",
        objectId: "case_002",
      },
      {
        code: "CONTENT_PACKAGE_JSON_INVALID",
        source: "progression.json",
        objectId: "progression",
      },
    ]);
  });

  it("rejects JSON files outside the fixed root/cases/stories layout", () => {
    const sources = packageSources();
    sources.push(
      { source: "cases/nested/case.json", text: "{}" },
      { source: "notes.json", text: "{}" },
      { source: "stories/.json", text: "{}" },
    );

    expect(failureIssues(sources).map(({ code, source }) => ({ code, source }))).toEqual([
      {
        code: "CONTENT_PACKAGE_FILE_UNRECOGNIZED",
        source: "cases/nested/case.json",
      },
      { code: "CONTENT_PACKAGE_FILE_UNRECOGNIZED", source: "notes.json" },
      { code: "CONTENT_PACKAGE_FILE_UNRECOGNIZED", source: "stories/.json" },
    ]);
  });

  it("maps structural and semantic case diagnostics to the owning case file", () => {
    const structuralSources = packageSources();
    replaceJson(structuralSources, "cases/case_001.json", (definition) => {
      definition.nodes.assessment.choices[0].text = "";
    });
    expect(failureIssues(structuralSources)[0]).toMatchObject({
      code: "CONTENT_SCHEMA_INVALID",
      source: "cases/case_001.json",
      objectId: "case_001",
      path: ["cases", "case_001", "nodes", "assessment", "choices", 0, "text"],
    });

    const semanticSources = packageSources();
    replaceJson(semanticSources, "cases/case_001.json", (definition) => {
      definition.id = "wrong_case_id";
      definition.nodes.orphan = {
        choices: [
          {
            id: "orphan_finish",
            text: "Finish",
            target: { type: "resolution", resolutionId: "warning" },
          },
        ],
      };
    });
    expect(failureIssues(semanticSources).map(({ code, source }) => ({ code, source }))).toEqual([
      { code: "CASE_KEY_ID_MISMATCH", source: "cases/case_001.json" },
      { code: "CASE_NODE_UNREACHABLE", source: "cases/case_001.json" },
    ]);
  });

  it("maps story structure diagnostics to the story file selected by its stem", () => {
    const sources = packageSources();
    replaceJson(sources, "stories/story_after_case_001.json", (story) => {
      story.steps = [];
    });

    expect(failureIssues(sources)[0]).toMatchObject({
      code: "CONTENT_SCHEMA_INVALID",
      source: "stories/story_after_case_001.json",
      objectId: "story_after_case_001",
      path: ["stories", "story_after_case_001", "steps"],
    });
  });

  it("keeps case record identity derived from the file stem", () => {
    const sources = packageSources();
    replaceJson(sources, "cases/case_001.json", (definition) => {
      definition.id = "renamed_inside_file";
    });

    const mismatch = failureIssues(sources).find((issue) => issue.code === "CASE_KEY_ID_MISMATCH");
    expect(mismatch).toMatchObject({
      source: "cases/case_001.json",
      objectId: "case_001",
      path: ["cases", "case_001", "id"],
    });
  });

  it("maps progression, asset, and other root diagnostics to their physical files", () => {
    const progressionSources = packageSources();
    replaceJson(progressionSources, "progression.json", (progression) => {
      progression.storyRules[0].when.all = [
        { type: "attributeAtLeast", attributeId: "missing_attribute", value: 1 },
      ];
    });
    expect(failureIssues(progressionSources)[0]).toMatchObject({
      code: "ATTRIBUTE_REFERENCE_INVALID",
      source: "progression.json",
      objectId: "story_after_case_001_rule",
    });

    const assetSources = packageSources();
    replaceJson(assetSources, "assets.json", (assets) => {
      assets.ending_balanced_video.path = "";
    });
    expect(failureIssues(assetSources)[0]).toMatchObject({
      code: "CONTENT_SCHEMA_INVALID",
      source: "assets.json",
      objectId: "ending_balanced_video",
    });

    const initialSources = packageSources();
    replaceJson(initialSources, "initial.json", (initial) => {
      initial.caseIds = ["missing_case"];
    });
    expect(failureIssues(initialSources)[0]).toMatchObject({
      code: "CASE_REFERENCE_INVALID",
      source: "initial.json",
      objectId: "initial",
    });

    const endingSources = packageSources();
    replaceJson(endingSources, "endings.json", (endings) => {
      endings.balanced.storyId = "missing_story";
    });
    expect(failureIssues(endingSources)[0]).toMatchObject({
      code: "STORY_REFERENCE_INVALID",
      source: "endings.json",
      objectId: "balanced",
    });

    const manifestSources = packageSources();
    replaceJson(manifestSources, "manifest.json", (manifest) => {
      manifest.title = "";
    });
    expect(failureIssues(manifestSources)[0]).toMatchObject({
      code: "CONTENT_SCHEMA_INVALID",
      source: "manifest.json",
      objectId: "manifest",
    });
  });

  it("rejects extra progression envelope keys without dropping them during assembly", () => {
    const sources = packageSources();
    replaceJson(sources, "progression.json", (progression) => {
      progression.unexpectedRules = [];
    });

    expect(failureIssues(sources)).toEqual([
      {
        code: "CONTENT_SCHEMA_INVALID",
        source: "progression.json",
        objectId: "progression",
        path: ["unexpectedRules"],
        message: 'Unrecognized key "unexpectedRules" in progression.json.',
      },
    ]);
  });
});
