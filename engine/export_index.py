"""A short list of the names each source file really exports, shown to the coder with the source excerpts.

A large file is shown as excerpts, so the coder cannot see which names it exports; a live run wrote a test that imported
`review` from a module whose export is `reviewPR`. Listing the real names lets a new test import what exists.
"""
import re

JS_EXPORT_RE = re.compile(r'^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)', re.M)
JS_LIST_RE = re.compile(r'^\s*export\s*\{([^}]*)\}', re.M)
PY_RE = re.compile(r'^(?:async\s+def|def|class)\s+([A-Za-z][\w]*)', re.M)
JS_SUFFIXES = ('.js', '.mjs', '.ts')
HEADER = ('===== NAMES EACH FILE EXPORTS (a test or new module may import only these; a name not listed here does not exist, '
          'so read the file before importing anything else) =====\n')


def names(path, text):
    """Exported names (JavaScript/TypeScript) or top-level public names (Python), in file order, without duplicates."""
    if path.endswith(JS_SUFFIXES):
        found = JS_EXPORT_RE.findall(text)
        for group in JS_LIST_RE.findall(text):
            found += [part.split(' as ')[-1].strip() for part in group.split(',') if part.strip()]
    elif path.endswith('.py'):
        found = [name for name in PY_RE.findall(text) if not name.startswith('_')]
    else:
        return []
    return list(dict.fromkeys(found))


def render(sources, order, cap=1500):
    """The header and one line per file, in `order`, stopping at `cap` characters. Empty when nothing qualifies."""
    lines, used = [], len(HEADER)
    for path in order:
        if path.startswith('tests/') or '/tests/' in path or path not in sources:
            continue
        listed = names(path, sources[path])
        if not listed:
            continue
        line = path + ': ' + ', '.join(listed[:40]) + '\n'
        if used + len(line) > cap:
            break
        lines.append(line)
        used += len(line)
    return HEADER + ''.join(lines) if lines else ''
