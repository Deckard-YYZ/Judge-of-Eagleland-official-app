import { spawnSync } from "node:child_process";
import { access, copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const assets = join(root, "artifacts/voice");
const output = join(root, "artifacts/voice-cli");
const target = join(root, "artifacts/voice-cli-target");
if (process.platform !== "win32")
  throw new Error("The voice CLI package currently targets Windows.");
const models = [
  "encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx",
  "decoder-epoch-13-avg-2-chunk-16-left-64.onnx",
  "joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx",
  "tokens.txt",
];
const dlls = ["sherpa-onnx-c-api.dll", "onnxruntime.dll", "onnxruntime_providers_shared.dll"];
for (const name of models) await access(join(assets, "model", name));
for (const name of dlls) await access(join(assets, "native/lib", name));
// A separate target keeps this tool independent of the running desktop app and its DLLs.
const build = spawnSync(
  "cargo",
  ["build", "--locked", "--manifest-path", "tools/voice-cli/Cargo.toml", "--target-dir", target],
  {
    cwd: root,
    env: { ...process.env, SHERPA_ONNX_LIB_DIR: join(assets, "native/lib") },
    stdio: "inherit",
    windowsHide: true,
  },
);
if (build.error || build.status !== 0)
  throw new Error("Voice CLI build failed", { cause: build.error });
await mkdir(join(output, "model"), { recursive: true });
await copyFile(join(target, "debug/voice-test.exe"), join(output, "voice-test.exe"));
for (const name of models) await copyFile(join(assets, "model", name), join(output, "model", name));
for (const name of dlls) await copyFile(join(assets, "native/lib", name), join(output, name));
await copyFile(join(root, "tools/voice-cli/README.md"), join(output, "README.md"));
await copyFile(join(root, "tools/voice-cli/voice-test.cmd"), join(output, "voice-test.cmd"));
for (const name of [
  "voice-record.cmd",
  "voice-record.ps1",
  "voice-record-near.cmd",
  "voice-record-segment.cmd",
]) {
  await copyFile(join(root, "tools/voice-cli", name), join(output, name));
}
await copyFile(join(root, "src-tauri/voice/keywords.json"), join(output, "keywords.json"));
await import("./voice-cli-variants.mjs");
console.log(`Voice CLI ready: ${resolve(output)}`);
