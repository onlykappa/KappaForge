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
    def test_native_dispatch_pins_checkout_and_checks_the_actual_commit(self):
        source = (ROOT / '.github/workflows/ios-build.yml').read_text(encoding='utf-8')
        for job in ('sandbox', 'native'):
            section = source.split('  ' + job + ':\n', 1)[1]
            section = section.split('    - name: Verify candidate checkout', 1)
            self.assertIn('ref: ${{ inputs.candidate_sha || ', section[0])
            guard = section[1].split('    - ', 1)[0]
            self.assertIn('CANDIDATE_SHA: ${{ inputs.candidate_sha }}', guard)
            script = guard.split('      run: ', 1)[1].splitlines()[0]
            with tempfile.TemporaryDirectory() as folder:
                subprocess.run(['git', 'init', '-q', folder], check=True, capture_output=True)
                commit = ['git', '-C', folder, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'candidate']
                subprocess.run(commit, check=True, capture_output=True)
                candidate = subprocess.check_output(['git', '-C', folder, 'rev-parse', 'HEAD'], text=True).strip()
                env = dict(os.environ, CANDIDATE_SHA=candidate)
                self.assertEqual(subprocess.run([BASH, '-c', script], cwd=folder, env=env, capture_output=True).returncode, 0)
                subprocess.run(commit, check=True, capture_output=True)
                self.assertNotEqual(subprocess.run([BASH, '-c', script], cwd=folder, env=env, capture_output=True).returncode, 0,
                                    'A different checkout must never receive a green receipt for the requested candidate')

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


class NativeRequirementTests(unittest.TestCase):
    """The sandbox report says whether the engine's iOS build rule applies, so the task card waits only for real checks."""

    def marker(self, files, compare_ok=True):
        with tempfile.TemporaryDirectory() as folder:
            effects = Path(folder) / 'effects'
            env = dict(os.environ, BRANCH='kappa/dev-198', SHA=SHA, RESULT='success', CHECK_RUN_ID='123',
                       RUN_URL='https://github.com/onlykappa/KappaForge/actions/runs/123', GITHUB_REPOSITORY='onlykappa/KappaForge',
                       AUTOMATIC_FIXES='true', FILES='\n'.join(files), COMPARE_OK='1' if compare_ok else '', EFFECTS=effects.as_posix())
            harness = '''
gh(){
 if [ "$1 $2" = "api repos/$GITHUB_REPOSITORY/git/ref/heads/$BRANCH" ]; then printf '%s' "$SHA";
 elif [ "$1" = api ]; then [ -n "$COMPARE_OK" ] || return 1; printf '%s\\n' "$FILES";
 elif [ "$1" = pr ]; then printf 'Draft: Complete work';
 else printf '%s\\n' "$*" >> "$EFFECTS"; fi
}
jq(){ printf '%s\\n' "$*" >> "$EFFECTS"; printf '{}'; }
'''
            run = subprocess.run([BASH, '-c', harness + step('Post the test result on the task, where the chat sees it')],
                                 env=env, capture_output=True, text=True, encoding='utf-8')
            self.assertEqual(run.returncode, 0, run.stderr)
            effects = effects.read_text(encoding='utf-8')
            self.assertIn('nativeRequired:$nativeRequired', effects)
            return effects

    def test_only_app_file_changes_require_an_ios_build(self):
        self.assertIn('--argjson nativeRequired false', self.marker(['engine/developer.py', 'docs/notes.md']))
        for path in ('preview/ui.js', 'ios/KappaForge/App.swift', 'scripts/bundle-web.py', 'config/app.json',
                     '.github/workflows/ios-build.yml'):
            self.assertIn('--argjson nativeRequired true', self.marker(['engine/developer.py', path]), path)

    def test_unknown_or_truncated_changes_keep_the_ios_build_required(self):
        self.assertIn('--argjson nativeRequired true', self.marker(['engine/x.py'], compare_ok=False))
        self.assertIn('--argjson nativeRequired true', self.marker([]))
        self.assertIn('--argjson nativeRequired true', self.marker([f'engine/m{n}.py' for n in range(300)]))

    def test_workflow_paths_match_the_engine_rule(self):
        from engine import native_build
        source = (ROOT / '.github/workflows/sandbox-tests.yml').read_text(encoding='utf-8')
        patterns = source.split('case "$path" in ', 1)[1].split(')', 1)[0].split('|')
        self.assertEqual({p.rstrip('*') for p in patterns}, set(native_build.NATIVE_PATHS))


if __name__ == '__main__':
    unittest.main()
