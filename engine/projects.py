"""Trusted project registration is capability configuration, not task authorization."""
import json
import os
import re
from pathlib import Path

CONFIG = Path(__file__).resolve().parent.parent / 'config/projects.json'


def registered(repo):
    entry = json.loads(CONFIG.read_text()).get('projects', {}).get(repo)
    if not isinstance(entry, dict) or entry.get('enabled') is not True:
        raise PermissionError('Project is not registered for autonomous execution: ' + repo)
    if not isinstance(entry.get('branches'), str) or not isinstance(entry.get('maxWaitSeconds', 21600), int) or not 60 <= entry.get('maxWaitSeconds',21600) <= 86400:
        raise ValueError('Invalid registered project branch or waiting policy')
    re.compile(entry['branches'])
    for name, value in entry.get('budgets', {}).items():
        # Explicit null removes only the selected internal count ceiling.
        if name in ('edits', 'modelCalls', 'fixCycles') and value is None:
            continue
        if name not in ('edits','modelCalls','fixCycles') or type(value) is not int or not 1 <= value <= 1000:
            raise ValueError('Invalid registered project recovery budget')
    if entry.get('tokenEnv') and not re.fullmatch(r'[A-Z][A-Z0-9_]*', entry['tokenEnv']):
        raise ValueError('Invalid project credential reference')
    if entry.get('providers') is not None and (not isinstance(entry['providers'],list) or any(not isinstance(v,str) for v in entry['providers'])):
        raise ValueError('Invalid project provider policy')
    return entry


def access(repo, token):
    entry = registered(repo)
    name = entry.get('tokenEnv')
    credential = os.getenv(name, '') if name else token
    if not credential:
        raise PermissionError('Project access is unavailable; configure ' + str(name) + ' for ' + repo)
    return credential


def branch_allowed(repo, branch):
    return bool(re.fullmatch(registered(repo)['branches'], branch))
