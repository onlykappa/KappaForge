import sys
from pathlib import Path
import subprocess
import re
root = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
from tools.diagnostics import run

def main():
    subprocess.run([sys.executable,str(root/'scripts/configure.py'),'--check'],check=True)
    html = (root / 'preview/index.html').read_text()
    # The app's code lives in classic scripts loaded in this order; the page itself holds no inline script.
    assert not re.findall(r'<script>', html), 'Keep app code in preview/app-*.js, not inline in index.html'
    order = re.findall(r'<script src="\./(app-(?:state|dashboard|tasks|main)\.js)\?v=', html)
    assert order == ['app-state.js', 'app-dashboard.js', 'app-tasks.js', 'app-main.js'], order
    # Classic scripts share one global scope: a second top-level function with the same name silently replaces the
    # first, and a repeated const stops a whole script from loading. Neither shows up in a per-file syntax check.
    declared = {}
    for script in re.findall(r'<script src="\./([\w.-]+\.js)\?v=', html):
        for number, line in enumerate((root / 'preview' / script).read_text().split('\n'), 1):
            found = re.match(r'(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=', line)
            if found:
                declared.setdefault(found.group(1) or found.group(2), []).append(f'{script}:{number}')
    clashes = {name: places for name, places in declared.items() if len(places) > 1}
    assert not clashes, 'Global names declared twice across preview scripts: ' + str(clashes)
    for name in ['preview/app-state.js','preview/app-dashboard.js','preview/app-tasks.js','preview/app-main.js','preview/stream.js','preview/app-config.js','preview/core.js','preview/intent-guard.js','chat-backend/src/intent-guard.js','preview/settings.js','preview/ui.js','preview/markdown.js','chat-backend/src/streaming.js','chat-backend/src/index.js','chat-backend/src/intelligence.js','chat-backend/src/project-health.js','preview/actions-core.js','chat-backend/src/actions.js']:
        subprocess.run(['node','--check',str(root/name)],check=True)
    subprocess.run(['python3',str(root/'scripts/bundle-web.py')],check=True)
    print('Web and backend syntax, versions, shared bundle: passed')

if __name__=='__main__':sys.exit(run(main,'web-validation'))
