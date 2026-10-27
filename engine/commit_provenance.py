"""Validate repository commit hyperlinks against GitHub, independently of model reviews."""
import re
import urllib.error

MAX_REFERENCES = 32


class CommitReferenceError(ValueError):
    terminal = True
    category = 'commit_provenance'


def problems(repo, changes, read):
    pattern = re.compile(r'https://github\.com/' + re.escape(repo) + r'/commit/([^\s)#?<>/]+)')
    refs = sorted({ref for path, text in changes.items() if path.endswith(('.md', '.rst', '.txt'))
                   and isinstance(text, str) for ref in pattern.findall(text)})
    if len(refs) > MAX_REFERENCES:
        return ['Too many commit references to validate; split the documentation change']
    failures = []
    for ref in refs:
        if not re.fullmatch(r'[a-fA-F0-9]{7,40}', ref):
            failures.append('Invalid repository commit reference: ' + ref[:80])
            continue
        try:
            row = read(f'repos/{repo}/commits/{ref}')
        except urllib.error.HTTPError as error:
            failures.append(('Nonexistent' if error.code in (404, 422) else 'Unverified') + ' repository commit reference: ' + ref)
            continue
        except (urllib.error.URLError, TimeoutError, ValueError):
            failures.append('Unverified repository commit reference: ' + ref)
            continue
        sha = row.get('sha') if isinstance(row, dict) else None
        if not isinstance(sha, str) or not re.fullmatch('[a-f0-9]{40}', sha) or not sha.startswith(ref.lower()):
            failures.append('Unverified repository commit reference: ' + ref)
    return failures


def require_valid(repo, changes, read):
    failures = problems(repo, changes, read)
    if failures:
        raise CommitReferenceError('; '.join(failures))
