"""Fail early for only the tools needed by this job. Never boot or build an app."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tools.build_config import ROOT,load_config
from tools.diagnostics import run


def check(target, which=shutil.which, execute=subprocess.run, platform=sys.platform):
    config=load_config();required={'web':['node','npm'],'worker':['node','npm'],'native':['node','npm','xcrun','xcodebuild','xcodegen','swift'],'agent':['python3']}[target]
    missing=[name for name in required if not which(name)]
    if missing:raise RuntimeError('Missing required tools: '+', '.join(missing)+'. Install them before running '+target+'.')
    if target!='agent':
        result=execute(['node','--version'],capture_output=True,text=True,check=True,timeout=15)
        if int(result.stdout.strip().lstrip('v').split('.')[0])<int(config['nodeVersion']):
            raise RuntimeError('Node '+config['nodeVersion']+' or newer is required. Use .nvmrc.')
    if target=='worker' and not (ROOT/'chat-backend/node_modules/.bin/wrangler').exists():
        raise RuntimeError('Locked Wrangler is missing. Run npm ci --ignore-scripts --prefix chat-backend.')
    if target=='native':
        if platform!='darwin':raise RuntimeError('Native builds require macOS and Xcode. Web development does not.')
        result=execute(['xcrun','simctl','list','devices','available','-j'],capture_output=True,text=True,check=True,timeout=20)
        spec=importlib.util.spec_from_file_location('simulator',ROOT/'scripts/select-simulator.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        module.select_simulator(json.loads(result.stdout))
    print('Preflight: '+target+' requirements satisfied')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('target',choices=['web','worker','native','agent']);args=parser.parse_args()
    check(args.target)
    subprocess.run([sys.executable,str(ROOT/'scripts/configure.py'),'--check'],check=True)

if __name__=='__main__':sys.exit(run(main,'preflight'))
