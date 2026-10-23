import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]
BASH = shutil.which('bash') if os.name != 'nt' else r'C:\Program Files\Git\bin\bash.exe'
SHA = 'a' * 40


def step(name):
    source = (ROOT / '.github/workflows/sandbox-tests.yml').read_text(encoding='utf-8')
    section = source.split('    - name: ' + name, 1)[1].split('    - name:', 1)[0]
    return textwrap.dedent(section.split('      run: |\n', 1)[1].split('      shell:', 1)[0])


class ValidationWorkflowTests(unittest.TestCase):
    def run_step(self, name, head=SHA, result='success', title='Draft: Complete work'):
        with tempfile.TemporaryDirectory() as folder:
            effects = Path(folder) / 'effects'
            env = dict(os.environ, BRANCH='kappa/dev-198', SHA=SHA, HEAD=head,
                       RESULT=result, PR_TITLE=title, CHECK_RUN_ID='123',
                       RUN_URL='https://github.com/onlykappa/KappaForge/actions/runs/123',
                       GITHUB_REPOSITORY='onlykappa/KappaForge', AUTOMATIC_FIXES='true',
                       EFFECTS=effects.as_posix())
            # Exercise the production Bash control flow with network effects replaced.
            harness = '''
gh(){
 if [ "$1" = api ]; then printf '%s' "$HEAD";
 elif [ "$1" = pr ]; then printf '%s' "$PR_TITLE";
 else printf '%s\n' "$*" >> "$EFFECTS"; fi
}
jq(){ printf '%s\n' "$*" >> "$EFFECTS"; printf '{}'; }
'''
            run = subprocess.run([BASH, '-c', harness + step(name)], env=env,
                                 capture_output=True, text=True, encoding='utf-8')
            self.assertEqual(run.returncode, 0, run.stderr)
            return effects.read_text(encoding='utf-8') if effects.exists() else ''

    def test_old_candidate_neither_reports_nor_requests_a_fix(self):
        for name in ['Start an automatic fix for a failed agent development PR',
                     'Post the test result on the task, where the chat sees it']:
            self.assertEqual(self.run_step(name, head='b' * 40), '')

    def test_fix_keeps_the_task_number_after_other_regex_checks(self):
        effects = self.run_step('Start an automatic fix for a failed agent development PR', result='failure')
        self.assertIn('issue_number=198', effects)

    def test_incomplete_and_complete_reports_emit_different_completion_evidence(self):
        name = 'Post the test result on the task, where the chat sees it'
        incomplete = self.run_step(name, title='Draft (incomplete): Missing behavior')
        self.assertIn('work is not finished', incomplete)
        self.assertIn('--argjson workComplete false', incomplete)
        complete = self.run_step(name)
        self.assertIn('--argjson workComplete true', complete)
        self.assertIn('--arg sha ' + SHA, complete)
        self.assertIn('--argjson task 198', complete)
        self.assertIn('KAPPA_VALIDATION_V1', complete)

    def test_notification_job_can_read_the_candidate_ref(self):
        source = (ROOT / '.github/workflows/sandbox-tests.yml').read_text(encoding='utf-8')
        permissions = source.split('  notify:', 1)[1].split('    steps:', 1)[0]
        self.assertIn('contents: read', permissions)


if __name__ == '__main__':
    unittest.main()
