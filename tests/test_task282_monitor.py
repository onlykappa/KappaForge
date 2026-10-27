import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('task282_monitor',Path(__file__).resolve().parents[1]/'scripts/monitor-task282.py')
monitor=importlib.util.module_from_spec(spec);spec.loader.exec_module(monitor)

class TaskMonitorTests(unittest.TestCase):
    def test_no_overlaps_no_identical_retries_and_bounded_changes(self):
        self.assertEqual(monitor.decide('head','engine',{},True)[0],'running')
        self.assertEqual(monitor.decide('head','engine',{'attemptedKey':'head:engine'},False)[0],'unchanged')
        self.assertEqual(monitor.decide('head','new-engine',{'attemptedKey':'head:engine'},False)[0],'dispatch')
        self.assertEqual(monitor.decide('head','new-engine',{'dispatches':3},False)[0],'needs_review')
        self.assertEqual(monitor.decide('head','engine',{},False,True)[0],'complete')

    def test_closed_task_or_ready_for_merge_pr_never_dispatches(self):
        for issue,pr in [({'state':'closed'},{'state':'open','draft':True}),({'state':'open'},{'state':'open','draft':False})]:
            with patch.object(monitor,'api',side_effect=[issue,pr]) as api:
                monitor.main()
                self.assertEqual(api.call_count,2)

    def test_dispatch_is_debited_before_request_and_not_repeated_after_timeout(self):
        state={'version':1,'task':282,'repo':monitor.REPO,'status':'blocked'}
        comments=[{'user':{'login':'github-actions[bot]'},'body':'<!-- KAPPA_RECOVERY_V1 '+__import__('json').dumps(state)+' -->'}]
        calls=[]
        def api(path,method='GET',payload=None):
            calls.append((path,method,payload))
            if path=='issues/282':return {'state':'open'}
            if path=='pulls/284':return {'state':'open','draft':True,'head':{'sha':'head'}}
            if path.startswith('issues/282/comments?'):return comments
            if path.startswith('actions/workflows/agent.yml/runs'):return {'workflow_runs':[]}
            if path=='git/ref/heads/main':return {'object':{'sha':'engine'}}
            if method=='POST' and path=='issues/282/comments':return {'id':12}
            if path.endswith('/dispatches'):raise TimeoutError('ambiguous dispatch')
            self.fail(path)
        with patch.object(monitor,'api',side_effect=api):
            with self.assertRaises(TimeoutError):monitor.main()
        saved=calls[-2][2]['body']
        self.assertIn('"attemptedKey":"head:engine"',saved)
        self.assertEqual(calls[-1][0],'actions/workflows/agent.yml/dispatches')
        self.assertEqual(calls[-1][2]['inputs']['issue_number'],'282')
