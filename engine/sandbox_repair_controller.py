import hashlib
from . import sandbox, sandbox_tools, tool_loop

class SandboxRepairController:
    def __init__(self, session: sandbox.Session):
        self.session = session
        self.tools = sandbox_tools.SandboxTools(session)
        self.attempts = []

    def run_repair(self, task_description, run_model, api_key):
        try:
            for attempt_idx in range(1, 6):
                result = tool_loop.run_tool_loop(run_model, api_key, task_description, self.tools)
                diff_info = self.tools.inspect_diff()
                diff = diff_info.get('diff', '')
                fingerprint = hashlib.sha256(diff.encode()).hexdigest()
                
                steps = result.get('steps', [])
                attempt = {
                    'index': attempt_idx,
                    'diff': diff,
                    'fingerprint': fingerprint,
                    'results': result,
                    'rationale': steps[-1].get('reason', '') if steps else 'No steps taken',
                    'logs': self.tools.read_execution_log().get('output', ''),
                    'changed_paths': diff_info.get('changed_paths', [])
                }
                if self.attempts:
                    attempt['diff_from_prev'] = (diff != self.attempts[-1]['diff'])
                if self.attempts:
                    attempt['diff_from_prev'] = (diff != self.attempts[-1]['diff'])
                
                if any(a['fingerprint'] == fingerprint for a in self.attempts):
                    break
                
                self.attempts.append(attempt)
                
                if self._verify_success(result):
                    regression = self.tools.run_tests()
                    if regression.get('passed'):
                        return {'status': 'success', 'attempt': attempt_idx, 'summary': result.get('summary')}
                
                if attempt_idx >= 5:
                    break
            return {'status': 'failed', 'last_attempt': len(self.attempts), 'last_diff': self.attempts[-1]['diff'], 'logs': self.attempts[-1]['logs']}
        finally:
            self.session.close()

    def _verify_success(self, result):
        if result.get('stop_reason') != 'done':
            return False
        test_res = self.tools.run_tests()
        return test_res.get('ok') and test_res.get('passed')