"""Pin, hash-check and stage official CPU assets. No microphone or user data access."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import urllib.request
import venv

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "artifacts" / "voice"
SPEC = json.loads((ROOT / "scripts" / "voice-assets.json").read_text(encoding="utf-8"))


def download(name, entry):
    path = CACHE / name
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
        print("Downloading pinned asset:", entry["url"], flush=True)
        with urllib.request.urlopen(entry["url"], timeout=60) as response:
            data = response.read(100 * 1024 * 1024)
        if hashlib.sha256(data).hexdigest() != entry["sha256"]:
            raise RuntimeError("Official asset SHA-256 mismatch: " + name)
        path.write_bytes(data)
    return path


def stage(archive, prefix, names, destination):
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:bz2") as source:
        for name in names:
            # Explicit members only: never extract paths or links from an archive.
            member = source.getmember(prefix + "/" + name)
            if not member.isfile() or member.size > 64 * 1024 * 1024:
                raise RuntimeError("Invalid voice asset member")
            data = source.extractfile(member).read()
            target = destination / Path(name).name
            temporary = target.with_suffix(target.suffix + ".tmp")
            temporary.write_bytes(data)
            os.replace(temporary, target)


def generate():
    spec = importlib.util.spec_from_file_location("official_sherpa_utils", CACHE / "official-utils.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    aliases = json.loads((CACHE / "aliases.json").read_text(encoding="utf-8"))
    keywords = {}
    rows = aliases["rows"]
    for row in rows:
        text = row["alias"].upper() if row["locale"] == "en-US" else row["alias"]
        result = module.text2token([text], tokens=str(CACHE / "model" / "tokens.txt"), tokens_type="phone+ppinyin", lexicon=str(CACHE / "model" / "en.phone"))
        # Official converter skips unsupported text. Fail here rather than silently
        # losing aliases or shifting action labels after a skipped result.
        if len(result) != 1 or not result[0]:
            raise RuntimeError("Alias has no valid official tokens: " + text)
        line = " ".join(result[0]) + " @" + row["actionId"]
        bucket = keywords.setdefault(row["locale"], [])
        if line not in bucket:
            bucket.append(line)
    target = ROOT / "src-tauri" / "voice" / "keywords.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"modelId": SPEC["modelId"], "tokenizerVersion": SPEC["sherpaVersion"], **aliases, "keywords": {key: "\n".join(value) + "\n" for key, value in keywords.items()}}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    if "--generate" in sys.argv:
        generate()
        return
    runtime = download("runtime.tar.bz2", SPEC["runtime"])
    model = download("model.tar.bz2", SPEC["model"])
    download("official-utils.py", SPEC["tokenizer"])
    prefix = "sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-lib/lib"
    stage(runtime, prefix, ["sherpa-onnx-c-api.dll", "sherpa-onnx-c-api.lib", "onnxruntime.dll", "onnxruntime.lib", "onnxruntime_providers_shared.dll"], CACHE / "native" / "lib")
    stage(model, SPEC["modelId"], ["encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx", "decoder-epoch-13-avg-2-chunk-16-left-64.onnx", "joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx", "tokens.txt", "en.phone"], CACHE / "model")
    manifests = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in (CACHE / "model").iterdir() if path.name != "en.phone"}
    manifest_path = ROOT / "src-tauri" / "voice" / "model-manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifests, indent=2) + "\n", encoding="utf-8")
    environment = CACHE / "tokenizer-venv"
    python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.exists():
        venv.EnvBuilder(with_pip=True).create(environment)
    subprocess.run([str(python), "-m", "pip", "install", "--disable-pip-version-check", "pypinyin==0.55.0", "sentencepiece==0.2.1"], check=True)
    subprocess.run([str(python), "-X", "utf8", str(Path(__file__).resolve()), "--generate"], check=True)
    print("Voice assets prepared locally. Model redistribution license remains unconfirmed.")


if __name__ == "__main__":
    main()
