"""Bundle the single tested web source without changing the WebKit origin or app ID."""
from pathlib import Path
import shutil
import json
import re
root = Path(__file__).resolve().parents[1]
source = root / 'preview'
target = root / 'ios/KappaForge/Web'
files = ['index.html', 'settings.js', 'settings.css', 'core.js', 'version.json', 'icon.svg', 'manifest.webmanifest', 'sw.js']
for name in files:
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source / name, target / name)
version = json.loads((source / 'version.json').read_text())['version']
assert f'const APP_VERSION="{version}"' in (source / 'index.html').read_text()
assert f"MARKETING_VERSION: '{version}'" in (root / 'ios/project.yml').read_text()
for name in files:
    assert (source / name).read_bytes() == (target / name).read_bytes(), name
print(f'Bundled {len(files)} shared files, v{version}')
