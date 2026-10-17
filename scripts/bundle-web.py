"""Bundle the tested source without changing origin, app ID, or user data."""
from pathlib import Path
import shutil
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tools.build_config import ROOT, load_config
from tools.diagnostics import run


def main():
    config=load_config();source=ROOT/config['webSource'];target=ROOT/config['iosWebBundle']
    files=['index.html','app-state.js','app-dashboard.js','app-tasks.js','app-main.js','app-config.js','stream.js','settings.js','settings.css','core.js','design.css','ui.js','markdown.js','version.json','icon.svg','manifest.webmanifest','sw.js']
    for name in files:
        target.mkdir(parents=True,exist_ok=True);shutil.copy2(source/name,target/name)
    if 'const APP_VERSION=KappaConfig.version;' not in (source/'app-main.js').read_text():raise ValueError('Frontend does not use generated build metadata')
    for name in files:
        if (source/name).read_bytes()!=(target/name).read_bytes():raise ValueError('Bundle differs: '+name)
    print('Bundled '+str(len(files))+' shared files, v'+config['version'])

if __name__=='__main__':sys.exit(run(main,'bundle'))
