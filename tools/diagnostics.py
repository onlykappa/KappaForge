"""Consistent actionable errors; never serialize request bodies or environment values."""
import os
import re
import sys
import traceback


def error(message, component='automation'):
    safe = str(message)
    for name,value in os.environ.items():
        if len(value) >= 8 and re.search(r'TOKEN|SECRET|PASSWORD|API_KEY', name, re.I):
            safe = safe.replace(value,'[redacted]')
    safe = re.sub(r'([?&](?:key|token|access_token)=)[^&\s]+',r'\1[redacted]',safe,flags=re.I)
    print('Error: ['+component+'] '+safe,file=sys.stderr)
    if os.environ.get('GITHUB_ACTIONS')=='true':
        escaped=safe.replace('%','%25').replace('\r','%0D').replace('\n','%0A')
        print('::error title='+component+'::'+escaped,file=sys.stderr)


def run(main, component):
    try:
        result=main()
        return 0 if result is None else result
    except Exception as exc:
        error(type(exc).__name__+': '+str(exc),component)
        # Opt-in tracebacks are useful locally; routine CI errors avoid leaking payloads.
        if os.environ.get('KAPPA_DEBUG')=='1' and not os.environ.get('GITHUB_ACTIONS'):
            traceback.print_exc()
        return 1
