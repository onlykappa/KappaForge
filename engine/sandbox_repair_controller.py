import hashlib
from . import sandbox, sandbox_tools, tool_loop

class SandboxRepairController:
    def __init__(self, session: sandbox.Session):
        self.session = session
        self.tools = sandbox_tools.SandboxTools(session)
        self.attempts = []

    def run_repair(self, task_description, run_model, api_key):
        for attempt_idx in range(1, 6):
            attempt = {'index': attempt_idx, 'rationale': '', 'diff': '', 'results': None}
            result = tool_loop.run_tool_loop(run_model, api_key, task_description, self.tools)
            attempt['results'] = result
            attempt['diff'] = self.tools.inspect_diff()['diff']
            self.attempts.append(attempt)
            if self._verify_success(result):
                regression = self.tools.run_tests()
                if regression.get('passed'):
                    return {'status': 'success', 'attempt': attempt_idx, 'summary': result.get('summary')}
            if attempt_idx >= 5:
                break
        return {'status': 'failed', 'last_attempt': len(self.attempts), 'last_diff': self.attempts[-1]['diff']}

    def _verify_success(self, result):
        if result.get('stop_reason') != 'done':
            return False
        test_res = self.tools.run_tests()
        return test_res.get('ok') and test_res.get('passed')