"""Deterministic read planning for one new KappaForge architecture inventory.

This chooses evidence, never generates claims or bypasses review/testing.
"""
import re

TASK_RE = re.compile(r'\b(?:architecture|repository|source) inventory\b', re.I)
ENTRY_FILES = ('preview/index.html', 'preview/app-main.js', 'config/app.json',
               'chat-backend/wrangler.toml', 'ios/KappaForge/KappaForgeApp.swift',
               'ios/KappaForge/KappaWebView.swift', 'engine/runner.py',
               'config/projects.json', 'config/providers.json', 'config/execution-infrastructure.json',
               'preview/app-dashboard.js', 'preview/settings.js',
               'chat-backend/src/index.js')
CI_FILES = ('tests.yml', 'agent.yml', 'sandbox-tests.yml', 'project-tests.yml',
            'review-graph.yml', 'ios-build.yml', 'deploy-chat.yml', 'recovery.yml')


def target(task):
    if not TASK_RE.search(task):
        return None
    matches = re.findall(r'\bCreate only (docs/[A-Za-z0-9_./-]+\.md)(?=[:\s.]|$)', task)
    if len(matches) != 1 or '..' in matches[0] or '//' in matches[0]:
        return None
    return matches[0]


def evidence_ask(text):
    return bool((TASK_RE.search(text) and not re.search(r'\b(?:fix|implement|refactor|code|feature|button|screen|ui|endpoint|route|function)\b', text, re.I))
                or re.fullmatch(r'Inspect source and cite file paths/commit-pinned GitHub links[.]?', text, re.I)
                or re.fullmatch(r'(?:Label|Distinguish) source inspection (?:separately )?from (?:tests|checks) actually run'
                                r'(?:; record uncertainties instead of guessing)?[.]?', text, re.I))


def read_plan(task, files, limit):
    output = target(task)
    if (not output or output in files or not all(p in files for p in ENTRY_FILES)
            or re.search(r'\b(?:fix|implement|refactor|feature|button|screen|endpoint)\b', task, re.I)):
        return None
    workflows = sorted(p for p in files if re.fullmatch(r'\.github/workflows/[^/]+\.ya?ml', p))
    preferred = ['.github/workflows/' + p for p in CI_FILES if '.github/workflows/' + p in files]
    selected = list(dict.fromkeys(list(ENTRY_FILES) + preferred + workflows))[:limit]
    if not set(ENTRY_FILES) <= set(selected):
        return None
    design = ('One new documentation file. Read the actual HTML/script startup, native entry, Worker entry, '
              'agent entry and central configuration before describing them. Directory listing at the pinned source '
              'revision (not workflow execution evidence): ' + ', '.join(workflows) + '. '
              'Verify responsibilities against source; list uncertainty only for evidence actually unavailable. '
              'Keep the document factual and run the normal independent review and tests.')
    return selected, [], design


MAX_REVIEW_SOURCES = 32  # Within the existing forty-file source-context bound.


def excerpt(text, budget):
    if len(text) <= budget:
        return text
    # Put actual startup/dispatch/configuration lines ahead of long import lists.
    patterns = (r'<script\b[^>]*app-main\.js[^>]*>', r'<script\b[^>]*>', r'(?m)^.*(?:@main|WindowGroup|export default|async fetch|'
                r'if __name__|def main\(|main =|cpu_ms|subrequests|KAPPA_ROUTER_MAX_|'
                r'^name:|^on:|^  workflow_dispatch:|"webSource"|"iosWebBundle").*$')
    fragments = []
    used = 0
    for pattern in patterns:
        for match in re.finditer(pattern, text):
            piece = match.group()
            if piece not in fragments and used < budget:
                piece = piece[:max(0, budget - used)]
                fragments.append(piece)
                used += len(piece) + 1
    if used < budget:
        fragments.append(text[:budget - used])
    return '\n'.join(fragments)[:budget]


def review_context(read, changes, links, requested, limit, complete, known):
    targets = list(dict.fromkeys(p for refs in links.values() for p in refs if p in known))[:MAX_REVIEW_SOURCES]
    requested = [p for p in requested if p in known]
    queue = list(changes) + list(dict.fromkeys(list(requested) + targets))
    queue = list(dict.fromkeys(queue))[:40]
    blocks, seen, used = [], set(), 0
    for index, path in enumerate(queue):
        text = changes[path] if path in changes else read(path) or ''
        header = '\n===== CURRENT SOURCE ' + path + ' ('
        remaining = len(queue) - index
        available = max(0, limit - used - sum(len(p) + 140 for p in queue[index:]))
        # Keep the inventory itself visible; remaining files get bounded literal snippets.
        allocation = available // remaining
        if path in changes:
            allocation = max(allocation, available // 2)
        sample = excerpt(text, allocation)
        full = sample == text and bool(text)
        label = 'COMPLETE' if full else 'PARTIAL; selected literal snippets; request this file if proof is missing'
        block = header + label + ') =====\n' + sample + '\n'
        if used + len(block) > limit:
            break
        if full:
            complete.add(path)
        seen.add(path)
        blocks.append(block)
        used += len(block)
    return ''.join(blocks), seen
