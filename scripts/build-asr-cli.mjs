import { spawnSync } from "node:child_process";
import { access, copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "artifacts/asr-cli");
const target = join(root, "artifacts/voice-cli-target");
const native = join(root, "artifacts/voice/native/lib");
const models = ["model.int8.onnx", "tokens.txt", "LICENSE", "README.md"];
const dlls = ["sherpa-onnx-c-api.dll", "onnxruntime.dll", "onnxruntime_providers_shared.dll"];
if (process.platform !== "win32") throw new Error("ASR CLI currently targets Windows.");
for (const name of models) await access(join(root, "artifacts/asr/model", name));
for (const name of dlls) await access(join(native, name));
const build = spawnSync(
  "cargo",
  [
    "build",
    "--locked",
    "--manifest-path",
    "tools/voice-cli/Cargo.toml",
    "--bin",
    "asr-test",
    "--target-dir",
    target,
  ],
  {
    cwd: root,
    env: { ...process.env, SHERPA_ONNX_LIB_DIR: native },
    stdio: "inherit",
    windowsHide: true,
  },
);
if (build.error || build.status !== 0)
  throw new Error("ASR CLI build failed", { cause: build.error });
await mkdir(join(output, "model"), { recursive: true });
await copyFile(join(target, "debug/asr-test.exe"), join(output, "asr-test.exe"));
for (const name of models)
  await copyFile(join(root, "artifacts/asr/model", name), join(output, "model", name));
for (const name of dlls) await copyFile(join(native, name), join(output, name));
for (const name of ["asr-test.cmd", "asr-record.cmd", "asr-record.ps1"]) {
  await copyFile(join(root, "tools/voice-cli", name), join(output, name));
}
await copyFile(join(root, "tools/voice-cli/ASR_README.md"), join(output, "README.md"));
await copyFile(join(root, "scripts/asr-assets.json"), join(output, "model-source.json"));
console.log(`ASR CLI ready: ${output}`);
