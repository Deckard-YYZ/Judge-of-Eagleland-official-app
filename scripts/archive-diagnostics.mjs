import { verifySymbols } from "./diagnostic-symbols.mjs";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const mode = process.argv[2] ?? "release";
if (!["debug", "release"].includes(mode)) throw new Error("Use debug or release");
const binary = resolve(`src-tauri/target/${mode}/eagle-judge.exe`);
const result = spawnSync(binary, ["--diagnostics-build-info"], {
  encoding: "utf8",
  timeout: 10_000,
  windowsHide: true,
});
if (result.error || result.status !== 0)
  throw new Error("Cannot read executable build metadata", { cause: result.error });
const identity = JSON.parse(result.stdout.trim());
const frontend = JSON.parse(await readFile("dist/build-info.json", "utf8"));
if (identity.frontendBuildId !== frontend.buildId)
  throw new Error("Executable / dist mismatch; rebuild the native executable before archiving");
if (!/^[a-zA-Z0-9-]+$/.test(identity.buildId) || !/^[a-zA-Z0-9-]+$/.test(frontend.buildId))
  throw new Error("Invalid build identity");
const support = resolve(`artifacts/build-support/${frontend.buildId}`);
if (
  JSON.parse(await readFile(join(support, "build-info.json"), "utf8")).buildId !== frontend.buildId
)
  throw new Error("Source map support identity mismatch");
async function files(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error("Symlinks are not archive inputs");
    if (entry.isDirectory()) result.push(...(await files(join(root, entry.name))));
    else if (entry.isFile()) result.push(join(root, entry.name));
  }
  return result;
}
const supportFiles = await files(support);
if (!supportFiles.some((name) => name.endsWith(".map")))
  throw new Error("Matching source maps missing");
const inputs = [
  { from: binary, to: "native/eagle-judge.exe" },
  { from: resolve(`src-tauri/target/${mode}/eagle_judge.pdb`), to: "native/eagle_judge.pdb" },
  ...supportFiles.map((from) => ({
    from,
    to: `frontend/${relative(support, from).replaceAll("\\", "/")}`,
  })),
];
// Read all artifacts before creating the archive: missing symbols must fail loudly.
const payloads = await Promise.all(
  inputs.map(async (entry) => ({ ...entry, bytes: await readFile(entry.from) })),
);
verifySymbols(payloads[0].bytes, payloads[1].bytes);
const destination = resolve(`artifacts/diagnostic-archives/${identity.buildId}-${Date.now()}`);
await mkdir(destination, { recursive: true });
const manifest = [];
for (const entry of payloads) {
  await mkdir(resolve(destination, entry.to, ".."), { recursive: true });
  await writeFile(join(destination, entry.to), entry.bytes);
  manifest.push({
    path: entry.to,
    bytes: entry.bytes.length,
    sha256: createHash("sha256").update(entry.bytes).digest("hex"),
  });
}
await writeFile(
  join(destination, "archive-manifest.json"),
  JSON.stringify(
    { protocolVersion: 1, identity, createdAt: new Date().toISOString(), files: manifest },
    null,
    2,
  ),
);
console.log(destination);
