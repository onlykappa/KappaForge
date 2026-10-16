from pathlib import Path
import subprocess
import re
root = Path(__file__).resolve().parents[1]
html = (root / 'preview/index.html').read_text()
inline = re.findall(r'<script>([\s\S]*?)</script>', html)
assert len(inline) == 1
subprocess.run(['node', '--check', '--input-type=commonjs'], input=inline[0], text=True, check=True)
for name in ['preview/core.js','preview/settings.js','chat-backend/src/index.js','chat-backend/src/intelligence.js']:
    subprocess.run(['node','--check',str(root/name)],check=True)
subprocess.run(['python3',str(root/'scripts/bundle-web.py')],check=True)
print('Web and backend syntax, versions, shared bundle: passed')
