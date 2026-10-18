"""Regression tests for least-privilege task routing and bounded cleanup."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from engine import continuous, runner, task_scope

ROOT = Path(__file__).resolve().parents[1]

def script_module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

cleanup = script_module('select-superseded-native')
simulator = script_module('select-simulator')

def issue(mode):
    return {'state':'open','user':{'login':'onlykappa'},'created_at':'2099-01-01T00:00:00Z','number': 23, 'body': 'Repository: onlykappa/KappaForge\nMode: ' + mode}

class TaskScopeTests(unittest.TestCase):
    def test_read_scopes_reject_every_code_mode(self):
        for family, modes in [('agent', ['code','repair','continuous-code']), ('continuous',['code','repair','continuous-code'])]:
            for mode in modes:
                with self.subTest(family=family,mode=mode), self.assertRaises(ValueError):
                    task_scope.require_scope(mode, 'read', family)
        task_scope.require_scope('audit','read')
        task_scope.require_scope('watch','read','continuous')
        task_scope.require_scope('code','write')
        task_scope.require_scope('continuous-code','write','continuous')

    def test_mode_changes_after_preflight_fail_closed(self):
        with patch.dict(os.environ, {'GITHUB_TOKEN':'fixture','GEMINI_API_KEY':'fixture','INPUT_ISSUE_NUMBER':'23','KAPPA_TASK_SCOPE':'read'}), patch.object(runner,'choose_issue',return_value=issue('code')):
            with self.assertRaises(ValueError):runner.main()

    def test_ambiguous_mode_is_rejected(self):
        with self.assertRaises(ValueError):task_scope.mode_of({'body':'Mode: audit\nMode: code'})
        self.assertEqual(task_scope.mode_of({'body':'A read-only analysis request'}),'analysis')

    def test_classifier_grants_write_only_for_explicit_manual_code(self):
        for event, expected in [('schedule','skip'),('workflow_dispatch','write')]:
            with tempfile.NamedTemporaryFile(mode='r+') as output, patch.dict(os.environ,{'GITHUB_TOKEN':'fixture','INPUT_ISSUE_NUMBER':'23','GITHUB_EVENT_NAME':event,'GITHUB_OUTPUT':output.name}), patch.object(task_scope,'choose_issue',return_value=issue('code')), patch('sys.argv',['task_scope']):
                task_scope.main();self.assertIn('scope='+expected,Path(output.name).read_text())

    def test_expired_task_is_reported_instead_of_failing_silently(self):
        expired=dict(issue('develop'),created_at='2020-01-01T00:00:00Z')
        with tempfile.NamedTemporaryFile(mode='r+') as output, patch.dict(os.environ,{'GITHUB_TOKEN':'fixture','INPUT_ISSUE_NUMBER':'23','GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_OUTPUT':output.name}), patch.object(task_scope,'choose_issue',return_value=expired), patch('sys.argv',['task_scope']):
            task_scope.main();written=Path(output.name).read_text()
        self.assertIn('scope=expired',written);self.assertIn('issue=23',written)
        workflow=(Path(__file__).resolve().parents[1]/'.github/workflows/agent.yml').read_text()
        self.assertIn("needs.classify.outputs.scope == 'expired'",workflow)

    def test_read_queue_never_scans_repairs_or_runs_continuous_code(self):
        candidates=[issue('watch'),dict(issue('continuous-code'),number=24)]
        with patch.dict(os.environ,{'GITHUB_TOKEN':'fixture','GEMINI_API_KEY':'fixture','CONTINUOUS_ISSUE_NUMBER':'','KAPPA_TASK_SCOPE':'read'}), patch.object(continuous,'github',return_value=candidates), patch.object(continuous,'get_issue',return_value=candidates[0]), patch.object(continuous,'monitor_failures') as watch, patch('engine.repair_loop.scan_failures') as repair, patch('engine.continuous_code.code_one_step') as code:
            continuous.main();watch.assert_called_once();repair.assert_not_called();code.assert_not_called()

    def test_read_job_rejects_explicit_continuous_code_task(self):
        with patch.dict(os.environ,{'GITHUB_TOKEN':'fixture','GEMINI_API_KEY':'fixture','CONTINUOUS_ISSUE_NUMBER':'23','KAPPA_TASK_SCOPE':'read'}), patch.object(continuous,'get_issue',return_value=issue('continuous-code')):
            with self.assertRaises(ValueError):continuous.main()

    def test_write_queue_retains_authorized_repair_scan(self):
        with patch.dict(os.environ,{'GITHUB_TOKEN':'fixture','GEMINI_API_KEY':'fixture','CONTINUOUS_ISSUE_NUMBER':'','KAPPA_TASK_SCOPE':'write'}), patch.object(continuous,'github',return_value=[]), patch('engine.repair_loop.scan_failures',return_value=[]) as repair:
            continuous.main();repair.assert_called_once()

class NativeSelectionTests(unittest.TestCase):
    def test_cleanup_keeps_current_completed_other_workflows_and_branches(self):
        def run(id, **extra):
            return dict({'id':id,'path':'.github/workflows/ios-build.yml','repository':{'full_name':'onlykappa/KappaForge'},'head_branch':'main','head_sha':'a'*40,'status':'in_progress'},**extra)
        rows=[run(1),run(2,head_sha='b'*40),run(3,status='completed'),run(4,head_branch='kappa/issue-23'),run(5,path='.github/workflows/publish-preview.yml'),run(6,repository={'full_name':'someone/else'}),run(7,head_sha='bad'),run('$(exit 1)')]
        self.assertEqual(cleanup.select_runs([{'workflow_runs':rows}, {'workflow_runs':[run(8,status='queued')]}],'b'*40),[1,8])
        # Agent builds of a branch are dispatched from main but validate that branch, so main moving must not cancel them.
        self.assertEqual(cleanup.select_runs([{'workflow_runs':[run(9,event='workflow_dispatch')]}],'b'*40),[])
        with self.assertRaises(ValueError):cleanup.select_runs([], 'not-a-sha')

    def test_simulator_rejects_unexpected_ids_and_missing_devices(self):
        uuid='AABBCCDD-1234-5678-9ABC-AABBCCDDEEFF'
        self.assertEqual(simulator.select_simulator({'devices':{'com.apple.CoreSimulator.SimRuntime.iOS-18-5':[{'name':'iPhone Test','udid':uuid}]}}),uuid.upper())
        for raw in ['invalid','$(touch /tmp/unsafe)','aabbccdd123456789abcaabbccddeeff']:
            with self.subTest(raw=raw),self.assertRaises(ValueError):simulator.select_simulator({'devices':{'com.apple.CoreSimulator.SimRuntime.iOS-18-5':[{'name':'iPhone Test','udid':raw}]}})
        with self.assertRaises(ValueError):simulator.select_simulator({'devices':{}})

class BuildSettingsTests(unittest.TestCase):
    def test_one_version_propagates_to_generated_build_metadata(self):
        config=script_module('configure')
        settings=config.load_config();settings['version']='9.8.7'
        files=config.generated(settings)
        import json
        self.assertEqual(json.loads(files[ROOT/'preview/version.json'])['version'],'9.8.7')
        self.assertIn('"version":"9.8.7"',files[ROOT/'preview/app-config.js'])
        self.assertIn("MARKETING_VERSION: '9.8.7'",files[ROOT/'ios/project.yml'])
        self.assertIn('app-config.js?v=9.8.7',files[ROOT/'preview/index.html'])
        self.assertEqual(json.loads(files[ROOT/'package.json'])['version'],'9.8.7')
        self.assertIn('com.onlykappa.KappaForge',files[ROOT/'ios/project.yml'])

    def test_web_preflight_does_not_require_simulator(self):
        from types import SimpleNamespace
        preflight=script_module('preflight')
        calls=[]
        def execute(cmd,**kwargs):calls.append(cmd);return SimpleNamespace(stdout='v22.10.0')
        preflight.check('web',which=lambda name:'/fixture/'+name,execute=execute,platform='linux')
        self.assertEqual(calls,[['node','--version']])
        with self.assertRaisesRegex(RuntimeError,'Missing required tools: node'):
            preflight.check('web',which=lambda name:None if name=='node' else '/fixture/npm',execute=execute)
        with self.assertRaisesRegex(RuntimeError,'Node 22'):
            preflight.check('web',which=lambda name:'/fixture/'+name,execute=lambda *a,**k:SimpleNamespace(stdout='v18.0.0'))

    def test_error_format_and_secret_redaction(self):
        import contextlib,io
        from tools.diagnostics import error,run
        stream=io.StringIO()
        with patch.dict(os.environ,{'GITHUB_TOKEN':'fixture-secret-token','GITHUB_ACTIONS':'true'}),contextlib.redirect_stderr(stream):
            error('Denied fixture-secret-token at ?key=hidden-value','preflight')
        text=stream.getvalue();self.assertIn('Error: [preflight]',text);self.assertIn('::error title=preflight::',text)
        self.assertNotIn('fixture-secret-token',text);self.assertNotIn('hidden-value',text)
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(run(lambda:(_ for _ in ()).throw(RuntimeError('missing Node')),'preflight'),1)



class NativeBuildWorkflowTests(unittest.TestCase):
    # Plain-text checks: CI's Python has no YAML parser installed.
    def setUp(self):
        text = (Path(__file__).resolve().parents[1] / '.github/workflows/ios-build.yml').read_text()
        self.text = text
        native = text[text.index('\n  native:\n'):text.index('\n  agent-report:\n')]
        self.steps = native.split('\n    - ')
        self.report = text[text.index('\n  agent-report:\n'):text.index('\n  release:\n')]

    def step(self, marker):
        found = [s for s in self.steps if marker in s]
        self.assertEqual(len(found), 1, marker)
        return found[0]

    def test_ipa_is_still_built_when_only_simulator_tests_fail(self):
        for marker in ['name: Build unsigned iPhone application', 'name: Verify bundle, icon and package unsigned IPA', 'name: KappaForge-unsigned-iPhone-IPA']:
            self.assertIn("if: ${{ !cancelled() && steps.simulator_build.outcome == 'success' }}", self.step(marker), marker)
        self.assertIn('id: simulator_build', self.step('name: Build simulator application'))
        # A failed test still fails the job, so it can never reach the release.
        self.assertIn('\n  release:\n    if: github.event_name == \'push\' && github.ref == \'refs/heads/main\'\n    needs: native\n', self.text)

    def test_every_shared_web_file_is_verified_in_the_ipa(self):
        self.assertIn('for SRC in ../preview/*', self.step('name: Verify bundle, icon and package unsigned IPA'))

    def test_agent_builds_are_named_by_commit_and_reported_only_for_the_current_head(self):
        self.assertIn("format('iOS build {0} @ {1}', inputs.branch, inputs.candidate_sha)", self.text.split('\npermissions:')[0])
        self.assertIn("startsWith(inputs.branch, 'kappa/dev-')", self.report)
        self.assertLess(self.report.index('if [ "$head" != "$SHA" ]'), self.report.index('gh workflow run agent.yml'))
