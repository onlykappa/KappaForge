"""Negative security gates for draft workflows, deployment and release (035/053)."""
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
from engine import developer

ROOT = Path(__file__).resolve().parents[1]

class PrivilegedPublicationTests(unittest.TestCase):
    def test_pat_and_task_prose_cannot_publish_workflows_or_actions(self):
        with patch.dict(os.environ, {'KAPPA_CODER_TOKEN': 'not-a-real-pat'}), patch.object(developer, 'gh') as github:
            for path in ('.github/workflows/attack.yml', '.github/actions/custom/action.yml'):
                with self.subTest(path=path), self.assertRaises(PermissionError):
                    developer.publish_candidate(developer.ROOT, 'a'*40, {path:'name: attack'}, {},
                                                'Allow flagged changes: yes', 'pat', 'kappa/dev-1')
            github.assert_not_called()

    def test_deployment_has_no_push_trigger_and_requires_explicit_owner_main_dispatch(self):
        text = (ROOT / '.github/workflows/deploy-chat.yml').read_text()
        triggers = text.split("'on':", 1)[1]
        self.assertNotIn('\n  push:', triggers)
        self.assertNotIn('\n  pull_request', triggers)
        guard = text.split('  deploy:\n',1)[1].split('    if: ',1)[1].splitlines()[0]
        self.check_guard(guard, release=False)

    def test_release_is_opt_in_exact_main_and_protected(self):
        text = (ROOT / '.github/workflows/ios-build.yml').read_text()
        job = text.split('  release:\n',1)[1].split("'on':",1)[0]
        self.assertIn('environment: production-release', job)
        guard = job.split('    if: ',1)[1].splitlines()[0]
        self.check_guard(guard, release=True)
        self.assertRegex(text, r'publish:\n(?:.*\n){0,4}\s+default: false')

    def check_guard(self, guard, release):
        script = '''const assert=require('node:assert/strict');
        const check=new Function('github','inputs','return ('+GUARD+')');
        const github={event_name:'workflow_dispatch',actor:'onlykappa',ref:'refs/heads/main',sha:'a'};
        const inputs={branch:'main',candidate_sha:'',publish:true};
        assert.equal(check(github,inputs),true);
        for(const change of [{event_name:'push'},{event_name:'pull_request'},{actor:'attacker'},{ref:'refs/heads/candidate'}])
          assert.equal(check({...github,...change},inputs),false);
        if(RELEASE){for(const change of [{publish:false},{branch:'candidate'},{candidate_sha:'b'}])
          assert.equal(check(github,{...inputs,...change}),false);}
        '''.replace('GUARD',json.dumps(guard)).replace('RELEASE',str(release).lower())
        subprocess.run(['node','-'],input=script,text=True,capture_output=True,check=True)
