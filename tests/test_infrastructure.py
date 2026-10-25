"""Free infrastructure admission: real policy and Session/Journal, injected APIs/daemon."""
import base64
import copy
from dataclasses import replace
import io
import json
import os
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

from engine import infrastructure as infra, execution, intent_guard, recovery, runner, sandbox, sandbox_tools, sandbox_repair_controller, task_goal
from tests.test_sandbox import FakeDocker
from tests.test_recovery_journal import GitHub

PUBLIC = dict(full_name=infra.ROOT, private=False, visibility='public', archived=False, disabled=False)
ENV = dict(GITHUB_ACTIONS='true', GITHUB_REPOSITORY=infra.ROOT, RUNNER_ENVIRONMENT='github-hosted',
           RUNNER_OS='Linux', GITHUB_SERVER_URL='https://github.com', GITHUB_RUN_ID='123',
           GITHUB_RUN_ATTEMPT='2', RUNNER_NAME='hosted-current')
JOB = dict(id=456, run_id=123, status='in_progress', runner_name='hosted-current', labels=['ubuntu-latest'])
INFO = dict(OSType='linux', NCPU=4, MemTotal=8 * 1024 ** 3, DockerRootDir='/var/lib/docker',
            MemoryLimit=True, SwapLimit=True, CpuCfsQuota=True, PidsLimit=True,
            SecurityOptions=['name=seccomp,profile=builtin'])
FREE = dict(memory=4 * 1024 ** 3, disk=8 * 1024 ** 3)
URL = 'https://api.github.com/repos/' + infra.ROOT + '/actions/workflows/agent.yml/dispatches'


class AdmissionTests(unittest.TestCase):
    def get(self, path):
        if path == 'repos/' + infra.ROOT:
            return copy.deepcopy(PUBLIC)
        if '/attempts/' in path:
            return dict(total_count=1, jobs=[copy.deepcopy(JOB)])
        if '/actions/workflows/' in path:
            return dict(state='active', path='.github/workflows/agent.yml')
        if '/git/ref/' in path:
            return dict(object=dict(sha='a' * 40))
        if '/contents/' in path:
            return dict(path='.github/workflows/agent.yml', encoding='base64',
                        content=base64.b64encode((infra.WORKFLOW_DIR / 'agent.yml').read_bytes()).decode())
        raise AssertionError(path)

    def test_current_public_standard_job_proves_allocated_free_capacity(self):
        evidence = infra.runtime(self.get, ENV)
        self.assertTrue(evidence['free'])
        self.assertEqual((evidence['job'], evidence['attempt']), (456, 2))
        read = Mock(side_effect=self.get)
        infra.runtime(read, ENV)
        self.assertIn('/attempts/2/jobs?', read.call_args.args[0], 'old attempts cannot attest to a resumed run')

    def test_private_or_unknown_repository_never_uses_a_guessed_free_allowance(self):
        for metadata in ({}, {**PUBLIC, 'private': True, 'visibility': 'private'}, {**PUBLIC, 'archived': True}):
            with self.subTest(metadata=metadata), self.assertRaisesRegex(infra.InfrastructureBlocked, 'public'):
                infra.runtime(lambda path: metadata, ENV)

    def test_self_hosted_local_or_unknown_job_is_not_an_approved_fallback(self):
        for changes in ({'RUNNER_ENVIRONMENT': 'self-hosted'}, {'GITHUB_ACTIONS': 'false'},
                        {'GITHUB_REPOSITORY': 'onlykappa/private'}, {'GITHUB_RUN_ATTEMPT': '0'}):
            get = Mock()
            with self.subTest(changes=changes), self.assertRaises(infra.InfrastructureBlocked):
                infra.runtime(get, {**ENV, **changes})
            get.assert_not_called()
        for changes in ({'labels': ['ubuntu-latest-16-cores']}, {'labels': ['self-hosted', 'ubuntu-latest']},
                        {'runner_name': 'other'}, {'status': 'completed'}, {'run_id': 122}):
            def get(path):
                return PUBLIC if path == 'repos/' + infra.ROOT else dict(total_count=1, jobs=[{**JOB, **changes}])
            with self.subTest(changes=changes), self.assertRaises(infra.InfrastructureBlocked):
                infra.runtime(get, ENV)

    def test_missing_permissions_or_metadata_is_actionable_and_does_not_echo_secrets(self):
        for failure in (PermissionError('private-key-value'), TimeoutError('private-key-value')):
            with self.subTest(failure=failure), self.assertRaises(infra.InfrastructureBlocked) as stopped:
                infra.runtime(Mock(side_effect=failure), ENV)
            self.assertIn('read access', str(stopped.exception))
            self.assertNotIn('private-key-value', str(stopped.exception))
        with self.assertRaises(infra.InfrastructureBlocked):
            infra.runtime(lambda path: [] if '/jobs?' in path else PUBLIC, ENV)

    def test_dispatch_checks_live_repository_workflow_and_unchanged_ref(self):
        get = Mock(side_effect=self.get)
        receipt = infra.authorize_dispatch(URL, {'ref': 'main'}, get=get)
        self.assertTrue(receipt['free'])
        self.assertEqual(receipt['revision'], 'a' * 40)
        self.assertEqual(sum('/git/ref/' in call.args[0] for call in get.call_args_list), 2)
        for source in infra.WORKFLOWS:
            self.assertTrue(infra.workflow_runners((infra.WORKFLOW_DIR / source).read_text(encoding='utf-8')))

    def test_changed_disabled_or_moving_workflow_cannot_allocate_a_job(self):
        for problem in ('changed', 'disabled', 'moved'):
            calls = 0
            def get(path):
                nonlocal calls
                data = self.get(path)
                if '/contents/' in path and problem == 'changed':
                    data['content'] = base64.b64encode(b'jobs:\n  test:\n    runs-on: ubuntu-latest-16-cores\n').decode()
                if '/actions/workflows/' in path and problem == 'disabled':
                    data['state'] = 'disabled_manually'
                if '/git/ref/' in path:
                    calls += 1
                    if calls == 2 and problem == 'moved':
                        data['object']['sha'] = 'b' * 40
                return data
            with self.subTest(problem=problem), self.assertRaises(infra.InfrastructureBlocked):
                infra.authorize_dispatch(URL, {'ref': 'main'}, get=get)

    def test_dynamic_paid_reusable_or_disguised_job_resources_are_rejected(self):
        for body in ('    runs-on: ubuntu-latest-16-cores', '    runs-on: [self-hosted, linux]',
                     '    runs-on: ${{ inputs.runner }}', '    uses: other/repo/.github/workflows/paid.yml@main',
                     '    runs-on: ubuntu-latest\n    "runs-on": ubuntu-paid',
                     '    runs-on: ubuntu-latest\n    strategy:\n      matrix: {}',
                     '    runs-on: ubuntu-latest\n    container: paid/image',
                     '    runs-on: ubuntu-latest\n  hidden: *paid'):
            with self.subTest(body=body), self.assertRaises(infra.InfrastructureBlocked):
                infra.workflow_runners('jobs:\n  test:\n' + body + '\n')
        with self.assertRaises(infra.InfrastructureBlocked):
            infra.authorize_dispatch(URL.replace('agent.yml', 'deploy-chat.yml'), {'ref': 'main'}, get=self.get)

    def test_automatic_reruns_cannot_reallocate_unpinned_runners(self):
        get = Mock(side_effect=self.get)
        for suffix in ('runs/9/rerun', 'runs/9/rerun-failed-jobs', 'jobs/9/rerun'):
            with self.subTest(suffix=suffix), self.assertRaisesRegex(infra.InfrastructureBlocked, 're-runs are not admitted'):
                infra.authorize_dispatch(f'https://api.github.com/repos/{infra.ROOT}/actions/{suffix}', {}, get=get)
        get.assert_not_called()
        self.assertIsNone(infra.authorize_dispatch(f'https://api.github.com/repos/{infra.ROOT}/actions/runs/9/cancel', {}, get=get))

    def test_every_repository_workflow_is_checked_for_billed_runners(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('execution_policy', infra.WORKFLOW_DIR.parents[1] / 'scripts/execution-policy.py')
        policy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(policy)
        policy.check_runners()  # The checked-in workflows, including ones the engine never dispatches.
        self.assertEqual(policy.paid_runners('on: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n  b:\n    runs-on: macos-15\n'), [])
        for body in ('    runs-on: ubuntu-latest-8-cores', '    runs-on: macos-15-xlarge', '    runs-on: [self-hosted, linux]',
                     '    runs-on: ${{ matrix.os }}', '    runs-on:\n      group: paid', '    uses: org/repo/.github/workflows/x.yml@v1',
                     '    steps: []'):
            with self.subTest(body=body):
                self.assertEqual(len(policy.paid_runners('jobs:\n  ok:\n    runs-on: ubuntu-latest\n  test:\n' + body + '\n')), 1)
        with patch.object(policy, 'paid_runners', return_value=['job: runs-on larger']), \
                self.assertRaisesRegex(ValueError, 'billed or unverifiable runners'):
            policy.check_runners()

    def test_real_request_boundary_blocks_dispatch_before_any_post(self):
        scope = intent_guard.ACTIVE.set(None)
        self.addCleanup(intent_guard.ACTIVE.reset, scope)
        with patch.object(infra, 'read', return_value={**PUBLIC, 'private': True}), \
                patch.object(intent_guard, 'guard_request') as authority, \
                patch.object(runner.urllib.request, 'urlopen') as transport:
            with self.assertRaises(infra.InfrastructureBlocked):
                runner.request(URL, {'ref': 'main'}, token='fixture')
        transport.assert_not_called()
        authority.assert_called_once()

    def test_admitted_dispatch_still_passes_the_real_owner_scope_and_github_post(self):
        old = intent_guard.ACTIVE.set(None)
        self.addCleanup(intent_guard.ACTIVE.reset, old)
        world = GitHub()
        scope = intent_guard.ACTIVE.get()
        payload = dict(ref='main', inputs=dict(issue_number='130', action='resume:1:' + scope.digest[:12]))
        with patch.object(infra, 'read', side_effect=lambda path, token=None: self.get(path)), \
                patch.object(runner.urllib.request, 'urlopen', side_effect=[
                    io.BytesIO(json.dumps(world.issue).encode()), io.BytesIO(b'')]) as transport:
            self.assertEqual(runner.request(URL, payload, token='fixture'), {})
        self.assertEqual(transport.call_count, 2)
        posted = transport.call_args.args[0]
        self.assertEqual(posted.get_method(), 'POST')
        self.assertEqual(json.loads(posted.data), payload)


class ResourceTests(unittest.TestCase):
    def resource_check(self, info=None, free=None, profile=None, preparing=True):
        docker = Mock()
        docker.call.return_value = sandbox.Exec(0, json.dumps(INFO if info is None else info), '')
        result = infra.resources(docker, profile or sandbox.PROFILES['test'], preparing,
                                 stats=lambda root: FREE if free is None else free)
        self.assertEqual(docker.call.call_count, 1, 'resource admission performs no allocation')
        return result

    def test_available_resources_and_kernel_enforcement_are_measured(self):
        self.assertEqual(self.resource_check()['availableDisk'], FREE['disk'])
        for key in ('MemoryLimit', 'SwapLimit', 'CpuCfsQuota', 'PidsLimit'):
            with self.subTest(key=key), self.assertRaises(infra.InfrastructureBlocked):
                self.resource_check({**INFO, key: False})
        with self.assertRaises(infra.InfrastructureBlocked):
            self.resource_check({**INFO, 'SecurityOptions': []})

    def test_resource_shortage_or_an_expanded_profile_never_upgrades_capacity(self):
        for free in ({**FREE, 'memory': 512 * infra.MIB}, {**FREE, 'disk': 1024 * infra.MIB}):
            with self.subTest(free=free), self.assertRaisesRegex(infra.InfrastructureBlocked, 'Do not upgrade'):
                self.resource_check(free=free)
        for profile in (replace(sandbox.PROFILES['test'], cpus='8'), replace(sandbox.PROFILES['test'], memory='8g')):
            with self.subTest(profile=profile), self.assertRaises(infra.InfrastructureBlocked):
                self.resource_check(profile=profile)

    def test_remote_docker_is_rejected_before_starting_a_cli_process(self):
        for override in ({'DOCKER_HOST': 'tcp://paid-builder:2376'}, {'DOCKER_CONTEXT': 'remote'}):
            with self.subTest(override=override), patch.dict(os.environ, override), \
                    patch.object(sandbox.subprocess, 'Popen') as process:
                with self.assertRaises(infra.InfrastructureBlocked):
                    sandbox.Docker().call(['info'])
                process.assert_not_called()

    def test_cli_forces_local_transport_and_empty_config_with_no_host_credentials(self):
        class Proc:
            returncode = 0
            def __init__(self):
                self.stdin, self.stdout, self.stderr = io.BytesIO(), io.BytesIO(), io.BytesIO()
            def wait(self, timeout=None):
                return 0
        seen = {}
        def process(argv, **kwargs):
            seen.update(argv=argv, env=kwargs['env'])
            directory = argv[argv.index('--config') + 1]
            self.assertEqual(os.listdir(directory), [])
            return Proc()
        with patch.dict(os.environ, {'HOME': 'credentials-at-home', 'DOCKER_HOST': 'unix:///run/docker.sock',
                                     'BUILDKIT_HOST': 'tcp://paid-builder:1234'}), \
                patch.object(sandbox.subprocess, 'Popen', side_effect=process):
            sandbox.Docker().call(['info'])
        self.assertEqual(seen['argv'][1:3], ['--host', 'unix:///var/run/docker.sock'])
        self.assertNotIn('HOME', seen['env'])
        self.assertNotIn('BUILDKIT_HOST', seen['env'])
        self.assertNotIn('DOCKER_HOST', seen['env'])

    def test_a_cached_image_does_not_bypass_fresh_permissions_and_capacity(self):
        docker = FakeDocker()
        docker.authorize = Mock(side_effect=[{'free': True}, infra.blocked('capacity was revoked')])
        work = sandbox.Session(sandbox.Tree(infra.ROOT, 'a' * 40, {'tests/test_x.py': b''}), docker)
        work.run(['python', '-m', 'unittest'])
        with self.assertRaises(infra.InfrastructureBlocked):
            work.run(['python', '-m', 'unittest'])
        self.assertEqual(len(docker.runs()), 1)
        self.assertEqual(docker.authorize.call_count, 2)

    def test_terminal_denial_keeps_the_patch_and_diagnostics_without_model_work(self):
        world = GitHub()
        journal = world.journal()
        journal.checkpoint('a' * 40, base='main')
        goal = task_goal.CURRENT.set(None)
        self.addCleanup(task_goal.CURRENT.reset, goal)
        docker = FakeDocker()
        docker.authorize = Mock(side_effect=infra.blocked('actual runner permissions were revoked'))
        work = sandbox.Session(sandbox.Tree(infra.ROOT, 'a' * 40, {'app.py': b'value=1\n', 'tests/test_x.py': b''}), docker)
        model = Mock(side_effect=AssertionError('no inference'))
        with self.assertRaises(infra.InfrastructureBlocked) as error:
            sandbox_repair_controller.SandboxRepairController(work, journal).run_repair(
                'repair', model, 'key', {'app.py': 'value=2\n'})
        self.assertEqual(execution.pending(world.journal())['changes'], {'app.py': 'value=2\n'})
        self.assertEqual(journal.state['executionDiagnostics']['status'], 'blocked')
        self.assertEqual(journal.state['executionDiagnostics']['errorCategory'], 'execution_resource')
        self.assertEqual(recovery.diagnose(error.exception), ('infrastructure_policy', 'stop'))
        self.assertFalse(journal.defer(error.exception))
        self.assertTrue(work.closed)
        self.assertEqual(docker.runs(), [])
        model.assert_not_called()

    def test_tool_unavailability_retains_the_terminal_resource_category(self):
        docker = FakeDocker()
        docker.authorize = Mock(side_effect=infra.blocked('no free memory'))
        work = sandbox.Session(sandbox.Tree(infra.ROOT, 'a' * 40, {'tests/test_x.py': b''}), docker)
        result = sandbox_tools.SandboxTools(work).run_tests()
        self.assertEqual((result['status'], result['category']), ('unavailable', 'execution_resource'))

    def test_preflight_stops_without_preparing_or_executing_any_container(self):
        with patch.object(sandbox.Docker, 'authorize', side_effect=infra.blocked('no free capacity')), \
                patch.object(sandbox.Docker, 'call') as execute, patch('sys.stderr', new=io.StringIO()) as output:
            self.assertEqual(infra.main(), 2)
        execute.assert_not_called()
        self.assertIn('no free capacity', output.getvalue())

    def test_module_entrypoint_gives_an_actionable_exit_in_an_unapproved_environment(self):
        result = subprocess.run([sys.executable, '-m', 'engine.infrastructure'], capture_output=True, text=True,
                                env={**os.environ, 'GITHUB_ACTIONS': 'false', 'DOCKER_HOST': '', 'DOCKER_CONTEXT': ''})
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('Free execution unavailable', result.stderr)
        self.assertNotIn('Traceback', result.stderr)
