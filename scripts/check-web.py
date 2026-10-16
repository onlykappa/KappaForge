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
    inline = re.findall(r'<script>([\s\S]*?)</script>', html)
    assert len(inline) == 1
    subprocess.run(['node', '--check', '--input-type=commonjs'], input=inline[0], text=True, check=True)
    for name in ['preview/app-config.js','preview/core.js','preview/settings.js','preview/ui.js','preview/markdown.js','chat-backend/src/index.js','chat-backend/src/intelligence.js','chat-backend/src/project-health.js']:
        subprocess.run(['node','--check',str(root/name)],check=True)
    subprocess.run(['python3',str(root/'scripts/bundle-web.py')],check=True)
    print('Web and backend syntax, versions, shared bundle: passed')

if __name__=='__main__':sys.exit(run(main,'web-validation'))
