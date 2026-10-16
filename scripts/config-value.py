"""Read one public build setting without shell evaluation."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tools.build_config import load_config
from tools.diagnostics import run

def main():
    if len(sys.argv)!=2:raise ValueError('Provide one build-setting key')
    value=load_config()[sys.argv[1]]
    if not isinstance(value,str) or '\n' in value:raise ValueError('Setting is not a single-line value')
    print(value)

if __name__=='__main__':sys.exit(run(main,'configuration'))
