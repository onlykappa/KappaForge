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
                rationale = steps[-1].get('reason', '') if steps and isinstance(steps[-1], dict) else 'No steps taken'
                
                if diff and not any(a['fingerprint'] == fingerprint for a in self.attempts):
                    attempt = {
                        'index': len(self.attempts) + 1,
                        'diff': diff,
                        'fingerprint': fingerprint,
                        'results': result,
                        'rationale': rationale,
                        'logs': self.tools.read_execution_log().get('output', ''),
                        'changed_paths': diff_info.get('changed_paths', [])
                    }
                    self.attempts.append(attempt)
                    if self._verify_success(result):
                        regression = self.tools.run_tests()
                        if regression.get('passed'):
                            return {'status': 'success', 'attempt': attempt['index'], 'summary': result.get('summary')}
                
                if len(self.attempts) >= 5:
                    break
            last_attempt = self.attempts[-1] if self.attempts else {'diff': '', 'logs': ''}
            return {'status': 'failed', 'last_attempt': len(self.attempts), 'last_diff': last_attempt['diff'], 'logs': last_attempt['logs']}
        finally:
            self.session.close()

    def _verify_success(self, result):
        if result.get('stop_reason') != 'done':
            return False
        test_res = self.tools.run_tests()
        ran = test_res.get('results', [{}])[0].get('ran', 0) if isinstance(test_res.get('results'), list) else 0
        return test_res.get('ok') and test_res.get('passed') and ran > 0