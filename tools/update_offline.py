"""Generate a versioned list of the public diary assets for offline use."""
from pathlib import Path
import hashlib
import json

dist = Path(__file__).resolve().parents[1] / "dist"
paths = [p for p in sorted(dist.rglob("*")) if p.is_file() and p.name not in {".DS_Store","diary-sw.js","offline-list.js"} and not any(part.startswith(".") for part in p.relative_to(dist).parts)]
digest = hashlib.sha256()
for path in paths + [dist / "diary-sw.js"]:
    digest.update(str(path.relative_to(dist)).encode())
    digest.update(path.read_bytes())
urls = ["./" + path.relative_to(dist).as_posix() for path in paths]
(dist / "offline-list.js").write_text("self.DIARY_BUILD = " + json.dumps(digest.hexdigest()[:16]) + ";\nself.DIARY_FILES = " + json.dumps(urls, ensure_ascii=False, indent=2) + ";\n")
print(len(paths), "public assets")
