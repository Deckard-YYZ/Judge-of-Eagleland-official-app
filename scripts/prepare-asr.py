"""Download a hash-pinned official ASR model; no audio leaves this machine."""
import hashlib
import json
import os
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
SPEC = json.loads((ROOT / "scripts/asr-assets.json").read_text(encoding="utf-8"))
CACHE = ROOT / "artifacts/asr"


def sha256(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    archive = CACHE / "model.tar.bz2"
    if not archive.exists() or sha256(archive) != SPEC["sha256"]:
        temporary = CACHE / "model.download"
        print("Downloading official SenseVoice int8 archive (about 163 MB)...", flush=True)
        with urllib.request.urlopen(SPEC["url"], timeout=60) as response, temporary.open("wb") as target:
            total = 0
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > 200 * 1024 * 1024:
                    raise RuntimeError("ASR archive exceeds expected size limit")
                target.write(chunk)
        if sha256(temporary) != SPEC["sha256"]:
            raise RuntimeError("ASR archive SHA-256 mismatch")
        os.replace(temporary, archive)
    destination = CACHE / "model"
    destination.mkdir(exist_ok=True)
    with tarfile.open(archive, "r:bz2") as source:
        # Explicit regular files only: archive paths and symbolic links are never extracted.
        for name in ("model.int8.onnx", "tokens.txt", "LICENSE", "README.md"):
            member = source.getmember(SPEC["modelId"] + "/" + name)
            if not member.isfile() or member.size > 300 * 1024 * 1024:
                raise RuntimeError("Invalid model asset: " + name)
            temporary = destination / (name + ".tmp")
            with source.extractfile(member) as data, temporary.open("wb") as target:
                for chunk in iter(lambda: data.read(1024 * 1024), b""):
                    target.write(chunk)
            os.replace(temporary, destination / name)
    print("ASR assets prepared: " + str(destination))


if __name__ == "__main__":
    main()
