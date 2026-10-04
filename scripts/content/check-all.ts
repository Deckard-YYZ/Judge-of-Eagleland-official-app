import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { buildContent, type BuildOptions } from "./build";
import { assertPackagePath } from "./media";

const root = fileURLToPath(new URL("../../", import.meta.url));
const RegistrySchema = z.array(z.strictObject({ source: z.string(), output: z.string() })).min(1);
export type AuthorPackageRegistration = z.infer<typeof RegistrySchema>[number];

/** An explicit registry is reviewed alongside packages; no incidental directory is a build target. */
export function parseAuthorPackageRegistry(input: unknown): AuthorPackageRegistration[] {
  const registrations = RegistrySchema.parse(input);
  const sources = new Set<string>();
  const outputs = new Set<string>();
  for (const entry of registrations) {
    for (const [value, prefix, seen] of [
      [entry.source, "content-authoring/samples/", sources],
      [entry.output, "content/", outputs],
    ] as const) {
      assertPackagePath(value);
      if (!value.startsWith(prefix)) throw new Error(`AUTHOR_REGISTRY_INVALID: ${value}`);
      if (prefix === "content/" && value.split("/").length !== 3)
        throw new Error(
          `AUTHOR_REGISTRY_INVALID: expected content/<packageId>/<version>: ${value}`,
        );
      const portable = value.normalize("NFC").toLowerCase();
      if (seen.has(portable)) throw new Error(`AUTHOR_REGISTRY_INVALID: duplicate ${value}`);
      seen.add(portable);
    }
  }
  return registrations;
}

export async function checkAllContent(
  lubanRoot: string | undefined,
  options: {
    registry?: unknown;
    build?: (options: BuildOptions) => Promise<unknown>;
  } = {},
): Promise<string[]> {
  if (!lubanRoot?.trim())
    throw new Error(
      "LUBAN_ROOT_REQUIRED: complete generation checks require the pinned tool checkout",
    );
  const registrations = parseAuthorPackageRegistry(
    options.registry ??
      JSON.parse(await readFile(path.join(root, "scripts/content/packages.json"), "utf8")),
  );
  const checked: string[] = [];
  // Sequential builds also keep the shared SDK output directory free of competing writers.
  for (const entry of registrations) {
    await (options.build ?? buildContent)({
      source: path.join(root, entry.source),
      output: path.join(root, entry.output),
      lubanRoot: path.resolve(lubanRoot),
      check: true,
    });
    checked.push(entry.output);
  }
  return checked;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--luban-root" || !args[1])) {
    console.error("Usage: content:check-all [--luban-root checkout]");
    process.exitCode = 1;
  } else {
    checkAllContent(args[1] ?? process.env.LUBAN_ROOT)
      .then((packages) =>
        console.log(`CHECKED ${packages.length} author packages\n${packages.join("\n")}`),
      )
      .catch((error: unknown) => {
        const failure = error as Error & { stdout?: Buffer; stderr?: Buffer };
        console.error(failure.message);
        if (failure.stdout) console.error(failure.stdout.toString());
        if (failure.stderr) console.error(failure.stderr.toString());
        process.exitCode = 1;
      });
  }
}
