"""Exact owner-requested validation commands supplement, never replace, mandatory regression."""
import re
import shlex
from engine import requirements


def requested_tests(request):
    commands = []
    for row in requirements.split(request):
        if requirements.paragraph_kind(request, row['start']) == 'background':
            continue
        match = re.match(r'^Run\s+`([^`\n]+)`(?:\s|[.;]|$)', row['text'], re.I)
        if not match:
            continue
        try:
            argv = shlex.split(match[1])
        except ValueError:
            raise ValueError('Owner validation command has unbalanced quotes; no command was executed') from None
        # This contract executes tests only. All commands still pass the sandbox's
        # independent command policy and run without network or credentials.
        rest = argv[1:]
        if argv and argv[0] in ('swift', 'xcodebuild', 'xcrun'):
            continue  # Existing native CI owns these receipts; no sandbox execution claim is made here.
        while rest and rest[0] in ('-B', '-u'):
            rest = rest[1:]
        testing = bool(argv) and ((argv[0] in ('python', 'python3') and len(rest) >= 2
                    and rest[:2] in (['-m', 'unittest'], ['-m', 'pytest']))
                    or argv[:2] in (['npm', 'test'], ['node', '--test'])
                    or len(argv) >= 3 and argv[:2] == ['npm', 'run']
                    and re.fullmatch(r'test(?::[A-Za-z0-9_-]+)?', argv[2]))
        if not testing:
            raise ValueError('Owner requested a command outside the supported validation profiles; '
                             'no arbitrary command was executed: use the scoped tool/approval workflow')
        if argv not in commands:
            commands.append(argv)
    return commands
