"""Typed verification evidence. Model declarations never mint controller receipts."""
from enum import Enum
import re


class EvidenceType(str, Enum):
    SOURCE = 'source_behavior'
    DIFF = 'diff_scope'
    TEST = 'test_command'
    AUTHORIZATION = 'authorization'
    PUBLICATION = 'publication'
    RUNTIME = 'runtime_result'


def scope_constraint(text):
    """Only explicit, fully parsed path restrictions; unknown prose stays reviewable source work."""
    text = ' '.join(str(text or '').replace('`', '').split()).rstrip('.')
    match = re.fullmatch(r'(Keep this task to|Create only|Change only|Modify only|Edit only|'
                         r'Do not change|Do not touch|Do not modify) (.+)', text, re.I)
    if not match:
        return None
    mode = 'deny' if match[1].lower().startswith('do not') else 'allow'
    values = re.split(r',\s*(?:and |or )?|\s+(?:and|or)\s+', match[2])
    paths = []
    for value in values:
        value = value.strip()
        if mode == 'deny' and value.lower() == 'workflows':
            paths.append('.github/workflows/')
        elif mode == 'deny' and value.lower() == 'any deploy path':
            # Conservative repository deployment boundary. Reject uncertain source
            # changes rather than asserting that a workflow/config change is safe.
            paths.extend(('.github/', 'chat-backend/', 'config/', 'ios/', 'scripts/'))
        elif (re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*(?:/)?', value)
              and ('/' in value or '.' in value)
              and all(part not in ('.', '..', '.git') for part in value.rstrip('/').split('/'))):
            paths.append(value)
        else:
            return None
    return (mode, tuple(paths)) if 0 < len(paths) <= 64 else None


def scope_satisfied(constraint, actual):
    mode, limits = constraint
    def included(path):
        return any(path.startswith(limit) if limit.endswith('/') else path == limit for limit in limits)
    return all(included(path) if mode == 'allow' else not included(path) for path in actual)


def source_evidence(value):
    """Legacy literal citations remain accepted; a typed receipt cannot masquerade as source."""
    return (isinstance(value, dict) and value.get('type', EvidenceType.SOURCE.value) == EvidenceType.SOURCE.value
            and isinstance(value.get('path'), str) and bool(value['path'].strip())
            and isinstance(value.get('quote'), str) and bool(value['quote'].strip()))
