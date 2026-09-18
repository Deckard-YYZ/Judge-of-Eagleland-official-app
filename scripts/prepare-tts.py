"""Prepare only pinned TTS model assets; reuse (never replace) the KWS 1.13.8 DLLs."""
import hashlib
import json
import os
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'artifacts' / 'tts'
SPEC = json.loads((ROOT / 'scripts' / 'tts-assets.json').read_text(encoding='utf-8'))
MANIFEST = json.loads((ROOT / 'src-tauri' / 'tts' / 'model-manifest.json').read_text(encoding='utf-8'))
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    archive = CACHE / 'model.tar.bz2'
    expected = SPEC['model']['sha256']
    if not archive.is_file() or digest(archive) != expected:
        temporary = archive.with_suffix('.download')
        try:
            with urllib.request.urlopen(SPEC['model']['url'], timeout=60) as response, temporary.open('wb') as output:
                total = 0
                while block := response.read(1024 * 1024):
                    total += len(block)
                    if total > MAX_ARCHIVE_BYTES:
                        raise RuntimeError('TTS archive exceeds fixed bound')
                    output.write(block)
            if digest(temporary) != expected:
                raise RuntimeError('TTS archive SHA-256 mismatch')
            os.replace(temporary, archive)
        finally:
            temporary.unlink(missing_ok=True)
    destination = CACHE / 'model'
    destination.mkdir(exist_ok=True)
    with tarfile.open(archive, 'r:bz2') as source:
        for name in SPEC['files']:
            # Explicit regular members only; ignore all bundled alternative weights/directories.
            if Path(name).name != name or name not in MANIFEST:
                raise RuntimeError('Uncontrolled TTS member')
            member = source.getmember(SPEC['modelId'] + '/' + name)
            if not member.isfile() or member.size > 200 * 1024 * 1024:
                raise RuntimeError('Invalid TTS archive member')
            data = source.extractfile(member).read()
            if hashlib.sha256(data).hexdigest() != MANIFEST[name]:
                raise RuntimeError('TTS member SHA-256 mismatch: ' + name)
            target = destination / name
            temporary = target.with_suffix(target.suffix + '.tmp')
            temporary.write_bytes(data)
            os.replace(temporary, target)
    print('TTS assets verified. Reuses existing voice runtime 1.13.8; no DLLs downloaded or replaced.')
    print(SPEC['licenseStatus'])


if __name__ == '__main__':
    main()
