import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Tables } from "../../content-authoring/generated/schema";
import { Tables as Tables5 } from "../../content-authoring/generated/schema5";
import {
  loadSplitContentPackage,
  type ContentPackageSource,
} from "../../src/content/localizedPackageFormat";
import { assemble, AuthoringError, locateIssue } from "./assemble";
import { assemble5 } from "./assemble5";
import { assemble6 } from "./assemble6";
import { Tables as Tables6 } from "../../content-authoring/generated/schema6";
import { GameContentManifestSchema } from "../../src/content/schema";
import { assertNoLinks, assertPackagePath, MediaSourceError, readAuthoringMedia } from "./media";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const json = async (filename: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(filename, "utf8")) as unknown;
  } catch (error) {
    throw new AuthoringError(
      { file: filename, objectId: "document", field: "<root>" },
      String(error),
    );
  }
};
export interface BuildOptions {
  source: string;
  output: string;
  lubanRoot: string;
  check?: boolean;
}

/** Rebuild pinned source before export; a stale or substituted DLL is not a version check. */
export function exportTables(
  lubanRoot: string,
  source: string,
  staging: string,
  lock: { commit: string; project: string; dll: string },
): void {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", lubanRoot, ...args], { encoding: "utf8" }).trim();
  if (
    git("rev-parse", "HEAD") !== lock.commit ||
    // Untracked C# and MSBuild files can change compilation even at the pinned HEAD.
    // Normal Git ignore rules still allow the checkout's bin/obj build outputs.
    git("status", "--porcelain", "--untracked-files=all") !== ""
  )
    throw new Error("LUBAN_VERSION_MISMATCH: tool checkout must match clean pinned commit");
  execFileSync(
    "dotnet",
    ["build", path.join(lubanRoot, lock.project), "-c", "Release", "--nologo"],
    { stdio: "pipe" },
  );
  execFileSync(
    "dotnet",
    [
      path.join(lubanRoot, lock.dll),
      "-t",
      "client",
      "--conf",
      path.join(source, "luban.conf"),
      "-c",
      "typescript-json",
      "-d",
      "json",
      "-x",
      `outputCodeDir=${path.join(staging, "code")}`,
      "-x",
      `outputDataDir=${path.join(staging, "data")}`,
    ],
    { stdio: "pipe" },
  );
}

async function inventory(directory: string, prefix = ""): Promise<string[]> {
  await assertNoLinks(directory);
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory())
      result.push(...(await inventory(path.join(directory, entry.name), relative + "/")));
    else if (entry.isFile()) result.push(relative);
    else throw new Error(`Unsupported package entry: ${relative}`);
  }
  return result.sort();
}

/** Existing version directories are immutable: regeneration may only confirm identical bytes.
 * A new directory is published by one rename after validation; failure leaves it absent.
 */
export async function publish(
  files: ReadonlyMap<string, string | Uint8Array>,
  output: string,
  stagedPackage: string,
  check: boolean,
): Promise<void> {
  const portableNames = new Set<string>();
  for (const filename of files.keys()) {
    assertPackagePath(filename);
    const portableName = filename.normalize("NFC").toLowerCase();
    if (portableNames.has(portableName))
      throw new Error(`PACKAGE_PATH_INVALID: case-insensitive collision ${filename}`);
    portableNames.add(portableName);
  }
  let existing: string[] | undefined;
  try {
    existing = await inventory(output);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing) {
    if (serialize(existing) !== serialize([...files.keys()].sort()))
      throw new Error("OUTPUT_DRIFT: package file inventory differs; use a new version");
    await assertNoLinks([...files.keys()].map((filename) => path.join(output, filename)));
    for (const [filename, contents] of files) {
      const expected =
        typeof contents === "string" ? Buffer.from(contents, "utf8") : Buffer.from(contents);
      if (!(await readFile(path.join(output, filename))).equals(expected))
        throw new Error(`OUTPUT_DRIFT: ${filename} differs; use a new version`);
    }
    return;
  }
  if (check) throw new Error("OUTPUT_MISSING: generate the package before checking");
  // The caller supplies a fresh child of its private staging directory.
  // Refuse pre-existing staging content instead of publishing unvalidated extra files.
  await mkdir(stagedPackage);
  await assertNoLinks(stagedPackage);
  for (const [filename, contents] of files) {
    await mkdir(path.dirname(path.join(stagedPackage, filename)), { recursive: true });
    await writeFile(path.join(stagedPackage, filename), contents, { flag: "wx" });
  }
  await mkdir(path.dirname(output), { recursive: true });
  await assertNoLinks(path.dirname(output));
  try {
    await rename(stagedPackage, output);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EXDEV")
      throw new Error("OUTPUT_CROSS_DEVICE: staging and output must be on the same filesystem", {
        cause: error,
      });
    throw error;
  }
}

export async function buildContent(options: BuildOptions) {
  const source = path.resolve(options.source);
  const output = path.resolve(options.output);
  const artifactRoot = path.join(root, "artifacts/content-authoring");
  await mkdir(artifactRoot, { recursive: true });
  const staging = await mkdtemp(path.join(artifactRoot, "run-"));
  const manifestSource = await json(path.join(source, "package.json"));
  const manifest = GameContentManifestSchema.parse(manifestSource);
  assertPackagePath(manifest.packageId);
  assertPackagePath(manifest.version);
  const schema5 = manifest.contentSchemaVersion === 5;
  const schema6 = manifest.contentSchemaVersion === 6;
  const modelFile = schema6 ? "schema6.ts" : schema5 ? "schema5.ts" : "schema.ts";
  const lock = JSON.parse(
    readFileSync(path.join(root, "content-authoring/luban.lock.json"), "utf8"),
  ) as { commit: string; project: string; dll: string };
  exportTables(path.resolve(options.lubanRoot), source, staging, lock);
  const generated = await readFile(path.join(staging, "code/schema.ts"), "utf8");
  const checkedIn = await readFile(
    path.join(root, "content-authoring/generated", modelFile),
    "utf8",
  );
  if (generated.replace(/\r\n/g, "\n") !== checkedIn.replace(/\r\n/g, "\n"))
    throw new Error(
      `AUTHOR_MODEL_DRIFT: review ${staging}/code/schema.ts and update content-authoring/generated/${modelFile} before compiling`,
    );
  const loadTable = (file: string) =>
    JSON.parse(readFileSync(path.join(staging, "data", `${file}.json`), "utf8")) as unknown;
  const rulesSource = await json(path.join(source, "rules.json"));
  const { game, mappings } = schema6
    ? assemble6(new Tables6(loadTable), new Tables5(loadTable), manifestSource, rulesSource)
    : schema5
      ? assemble5(new Tables5(loadTable), manifestSource, rulesSource)
      : assemble(new Tables(loadTable), manifestSource, rulesSource);
  if (
    path.basename(output) !== game.manifest.version ||
    path.basename(path.dirname(output)) !== game.manifest.packageId
  )
    throw new Error("OUTPUT_IDENTITY: output must end in <packageId>/<version>");
  const files = new Map<string, string | Uint8Array>([["game.json", serialize(game)]]);
  for (const name of await readdir(path.join(source, "locales"))) {
    if (!name.endsWith(".json")) throw new Error(`Unexpected localization source ${name}`);
    files.set(`locales/${name}`, serialize(await json(path.join(source, "locales", name))));
  }
  try {
    for (const [filename, contents] of await readAuthoringMedia(source, game.assets))
      files.set(filename, contents);
  } catch (error) {
    if (!(error instanceof MediaSourceError)) throw error;
    throw new AuthoringError(
      locateIssue(
        {
          code: "ASSET_FILE_MISSING",
          source: "game.json",
          objectId: error.assetId,
          path: ["assets", error.assetId, "path"],
          message: error.message,
        },
        mappings,
      ),
      error.message,
    );
  }
  const sources: ContentPackageSource[] = [...files]
    .filter(([filename]) => /\.json$/iu.test(filename))
    .map(([source, contents]) => ({
      source,
      text: typeof contents === "string" ? contents : Buffer.from(contents).toString("utf8"),
    }));
  const result = loadSplitContentPackage(sources, {
    fileInventory: [...files.keys()],
    expectedPackageId: game.manifest.packageId,
    expectedVersion: game.manifest.version,
  });
  await writeFile(path.join(staging, "sources.json"), serialize(mappings));
  if (!result.ok)
    throw new AuthoringError(
      locateIssue(result.issues[0], mappings),
      `${result.issues[0].code}: ${result.issues[0].message}`,
    );
  await publish(files, output, path.join(staging, "package"), options.check ?? false);
  return { output, staging, game: result.gameContent };
}

async function main(args: string[]): Promise<void> {
  if (args.includes("--help")) {
    console.log(
      "content:build [--source directory] [--output packageId/version] [--luban-root checkout] [--check]\nLUBAN_ROOT may supply the pinned tool checkout. Existing versions are never overwritten.",
    );
    return;
  }
  const values = new Map<string, string>();
  let check = false;
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === "--check") {
      check = true;
      continue;
    }
    if (
      !["--source", "--output", "--luban-root"].includes(name) ||
      !args[index + 1] ||
      args[index + 1].startsWith("--")
    )
      throw new Error(`Unknown or incomplete option ${name}`);
    values.set(name, args[++index]);
  }
  const lubanRoot = values.get("--luban-root") ?? process.env.LUBAN_ROOT;
  if (!lubanRoot)
    throw new Error(
      "LUBAN_ROOT_REQUIRED: set LUBAN_ROOT or --luban-root to the pinned Luban checkout",
    );
  const result = await buildContent({
    source: values.get("--source") ?? path.join(root, "content-authoring/samples/schema4"),
    output: values.get("--output") ?? path.join(root, "content/configuration-skeleton/0.1.0"),
    lubanRoot,
    check,
  });
  console.log(
    `${check ? "CHECKED" : "GENERATED"} ${result.output}\nIntermediate data and provenance: ${result.staging}`,
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    // Luban includes file/row/column diagnostics in its captured stdout and stderr.
    const failure = error as Error & { stdout?: Buffer; stderr?: Buffer };
    console.error(failure.message);
    if (failure.stdout) console.error(failure.stdout.toString());
    if (failure.stderr) console.error(failure.stderr.toString());
    process.exitCode = 1;
  });
}
