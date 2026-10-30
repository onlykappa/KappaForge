"""The controller's own account of the commands the sandbox ran: exact argv, status and any counts the runner printed.

These come from sandbox receipts, never from model text. Counts are parsed only from the two runners this project uses
(unittest and the Node test runner); anything else says the counts were not reported rather than guessing."""
import re

MAX_COMMANDS = 8
UNITTEST_RAN = re.compile(r'^Ran (\d+) tests? in ', re.M)
UNITTEST_SKIPPED = re.compile(r'\bskipped=(\d+)')
UNITTEST_FAILED = re.compile(r'\b(?:failures|errors)=(\d+)')
NODE_COUNT = {name: re.compile(rf'^# {name} (\d+)\s*$', re.M) for name in ('tests', 'pass', 'fail', 'skipped')}


def counts(output):
    """{'ran', 'skipped', 'failed'} when the output has a recognised summary, else None."""
    output = str(output or '')
    ran = UNITTEST_RAN.findall(output)
    if ran:
        tail = output[output.rindex('Ran '):]
        return dict(ran=int(ran[-1]), skipped=sum(map(int, UNITTEST_SKIPPED.findall(tail))),
                    failed=sum(map(int, UNITTEST_FAILED.findall(tail))))
    node = {name: pattern.findall(output) for name, pattern in NODE_COUNT.items()}
    if node['tests']:
        return dict(ran=int(node['tests'][-1]), skipped=int(node['skipped'][-1]) if node['skipped'] else 0,
                    failed=int(node['fail'][-1]) if node['fail'] else 0)
    return None


def _text(value, limit=160):
    """One line, no markdown structure, no backticks and no live @mention."""
    text = re.sub(r'\s+', ' ', str(value or '')).replace('`', "'").replace('@', '@​')
    return text if len(text) <= limit else text[:limit - 1] + '…'


def render(results):
    """A markdown block listing each sandbox command, its outcome and counts; '' when there is nothing to report."""
    lines = []
    for result in list(results or [])[:MAX_COMMANDS]:
        if not isinstance(result, dict):
            continue
        argv = result.get('argv')
        command = _text(' '.join(map(str, argv)) if isinstance(argv, (list, tuple)) else argv)
        if not command:
            continue
        status = _text(result.get('status') or 'unknown', 20)
        exit_code = result.get('exit_code')
        duration = result.get('duration_s')
        detail = [status]
        if isinstance(exit_code, int):
            detail.append(f'exit {exit_code}')
        if isinstance(duration, (int, float)):
            detail.append(f'{duration:.1f} s')
        found = counts(result.get('output'))
        tail = (f"ran {found['ran']:,}, skipped {found['skipped']:,}, failed {found['failed']:,}"
                if found else 'counts not reported by the runner')
        lines.append(f"- `{command}`: {', '.join(detail)}; {tail}")
    if not lines:
        return ''
    return '**Commands the sandbox ran** (controller receipts, not model claims):\n' + '\n'.join(lines)
