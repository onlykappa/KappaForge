"""Stable failed-edit identity shared by proposal generation and sandbox repair.

A different replacement or unrelated file cannot make a missing anchor match.
Exact source bytes and preceding same-file edits can change that condition.
"""
import hashlib
import json


def anchor_key(path, source, find, preceding):
    # Keep the existing sandbox checkpoint encoding unchanged.
    value = dict(path=path, source=hashlib.sha256(source).hexdigest() if source is not None else None,
                 find=find, preceding=[dict(find=row['find'], replace=row['replace']) for row in preceding])
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True, allow_nan=False).encode()).hexdigest()


def proposal_anchors(proposal, sources):
    """Yield only structurally valid inputs; the authoritative validator checks every proposal."""
    if not isinstance(proposal, dict) or not isinstance(proposal.get('files'), list):
        return
    for entry in proposal['files']:
        if not isinstance(entry, dict) or not isinstance(entry.get('path'), str):
            continue
        path = entry['path']
        if path not in sources or not isinstance(sources[path], str) or not isinstance(entry.get('edits'), list):
            continue
        preceding = []
        for edit in entry['edits']:
            if (not isinstance(edit, dict) or not isinstance(edit.get('find'), str) or not edit['find']
                    or not isinstance(edit.get('replace'), str)):
                break
            yield anchor_key(path, sources[path].encode(), edit['find'], preceding), path
            preceding.append(edit)
