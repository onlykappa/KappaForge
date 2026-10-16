import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def load_config():
    data = json.loads((ROOT / 'config/app.json').read_text())
    for key, pattern in [('version',r'\d+\.\d+\.\d+'),('repository',r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+'),('iosBundleIdentifier',r'[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)+'),('nodeVersion',r'\d+'),('pythonVersion',r'\d+\.\d+')]:
        if not re.fullmatch(pattern, data.get(key,'')):
            raise ValueError('Invalid build setting: ' + key)
    for key in ['webSource','iosWebBundle']:
        if not (ROOT / data[key]).resolve().is_relative_to(ROOT):
            raise ValueError('Build path must remain inside repository: ' + key)
    return data
