"""Real controller + real Node oracle; controlled fixture transport, NOT Docker isolation proof.

No live model, network, GitHub mutation or unknown generated program is executed.
The scripted provider adapts its patch to the real observed export list and file digest.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import shutil
import tarfile
import tempfile
import unittest
from engine import sandbox, sandbox_repair_controller
from tests.test_sandbox_repair_controller import FakeDocker

# Controlled transport: only these trusted static Node fixtures run in a temp directory.
# Real Docker isolation is validated separately on the supported GitHub-hosted runtime.
class FixtureNodeTransport(FakeDocker):
    def __init__(self):
        super().__init__(); self.actual_test_runs = []
    def call(self, args, stdin=b'', **kwargs):
        if args[:1] != ['run'] or not stdin:
            return super().call(args, stdin=stdin, **kwargs)
        try:
            with tarfile.open(fileobj=io.BytesIO(stdin), mode='r:*') as archive:
                files={m.name:archive.extractfile(m).read() for m in archive if m.isfile()}
        except tarfile.TarError:
            return super().call(args, stdin=stdin, **kwargs)
        if 'tests/review.test.mjs' not in files:
            return super().call(args, stdin=stdin, **kwargs)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name,data in files.items():
                if not sandbox.safe_path(name): raise AssertionError('Unsafe fixture extraction')
                target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
            result=subprocess.run([shutil.which('node'),'--test','--test-reporter=tap','tests/review.test.mjs'],cwd=tmp,
                env={'PATH':os.defpath},capture_output=True,text=True,timeout=10)
        self.actual_test_runs.append(result.returncode)
        return sandbox.Exec(result.returncode,result.stdout,result.stderr)

class OfflineRecoveryTests(unittest.TestCase):
    def test_wrong_export_and_malformed_reply_adapt_through_real_observations(self):
        files={'package.json': b'{"type":"module","scripts":{"test":"node --test tests/review.test.mjs"}}',
               'review.mjs': b'export function reviewPR() { return 42; }\n',
               'tests/review.test.mjs': b"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {review} from '../review.mjs';\ntest('real production export',()=>assert.equal(reviewPR(),42));\n"}
        transport=FixtureNodeTransport()
        work=sandbox.Session(sandbox.Tree('fixture','a'*40,files),docker=transport)
        agent=sandbox_repair_controller.SandboxRepairController(work)
        calls=[]
        def model(_key,prompt,**kw):
            history=[]
            for row in agent.state['history']:
                try: history.append(json.loads(row))
                except ValueError: pass
            if not calls:
                calls.append('malformed');return 'scripted-free','{"tool":"apply_patch","args":'
            symbols=next((x['result'] for x in reversed(history) if x.get('tool')=='inspect_symbols'),None)
            reading=next((x['result'] for x in reversed(history) if x.get('tool')=='read_file'),None)
            if not symbols:
                tool,args='inspect_symbols',{'path':'review.mjs'}
            elif not reading:
                tool,args='read_file',{'path':'tests/review.test.mjs','start_line':1,'end_line':4}
            else:
                self.assertIn('reviewPR',symbols['exports'])
                self.assertIn('sha256',reading)
                tool,args='apply_line_patch',{'path':reading['path'],'sha256':reading['sha256'],
                    'edits':[{'start_line':3,'end_line':3,'replace':"import {reviewPR} from '../review.mjs';\n"}]}
            calls.append(tool)
            reply = {'tool':tool,'args':args,'reason':'Use fresh export and file-version evidence to repair the failed import'}
            # Exercise all three Task322 parser failure classes against a real
            # failing Node import, preserving production code and assertions.
            encoded = json.dumps([reply] if tool == 'read_file' else reply)
            return 'scripted-free', '```json\n'+encoded+'\n```' if tool == 'inspect_symbols' else encoded
        result=agent.run_repair('Repair the incorrect test import; do not change production code or weaken assertions',model,'fixture')
        self.assertEqual(result['status'],'success',result.get('summary'))
        self.assertEqual(calls,['malformed','inspect_symbols','read_file','apply_line_patch'])
        self.assertIn(1,transport.actual_test_runs,'Independent Node must fail before the repair')
        self.assertEqual(transport.actual_test_runs[-2:],[0,0],'Candidate and fresh final regression must pass')
        self.assertEqual(work.current()['review.mjs'],files['review.mjs'])
        self.assertEqual(set(work.changes),{'tests/review.test.mjs'})
        self.assertEqual(hashlib.sha256(work.current()['review.mjs']).hexdigest(),hashlib.sha256(files['review.mjs']).hexdigest())
