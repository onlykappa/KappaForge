"""Bundle the tested source without changing origin, app ID, or user data."""
from pathlib import Path
import shutil
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tools.build_config import ROOT, load_config
from tools.diagnostics import run


def main():
    config=load_config();source=ROOT/config['webSource'];target=ROOT/config['iosWebBundle']
    files=[f.name for f in source.iterdir() if f.is_file() and f.name not in ['.DS_Store', 'bundle-web.py']]
    target.mkdir(parents=True,exist_ok=True)
    for name in files:
        shutil.copy2(source/name,target/name)
    if 'const APP_VERSION=KappaConfig.version;' not in (source/'app-main.js').read_text():raise ValueError('Frontend does not use generated build metadata')
    for name in files:
        if (source/name).read_bytes()!=(target/name).read_bytes():raise ValueError('Bundle differs: '+name)
    print('Bundled '+str(len(files))+' shared files, v'+config['version'])

if __name__=='__main__':sys.exit(run(main,'bundle'))
