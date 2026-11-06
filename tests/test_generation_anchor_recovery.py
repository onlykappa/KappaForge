"""Task322 failure-class replay: never redispatch the same deterministic bad anchor."""
import copy
import json
import unittest
from unittest.mock import patch
from engine import developer, edit_identity, intent_guard, recovery, sandbox_repair_controller, task_goal
from tests.test_recovery_journal import GitHub

SOURCES = {'value.py':'value = 1\n','other.md':'unchanged\n'}
EXISTING = {p:len(v) for p,v in SOURCES.items()}


def answer(find='missing', replace='value = 2', prefix=(), extra=False):
    files=[dict(path='value.py',edits=[*prefix,dict(find=find,replace=replace)])]
    if extra:files.append(dict(path='other.md',edits=[dict(find='unchanged',replace='unrelated change')]))
    return json.dumps(dict(summary='Correct the requested value', files=files))


class GenerationAnchorRecoveryTests(unittest.TestCase):
    def setUp(self):
        for var in (recovery.CURRENT,intent_guard.ACTIVE,task_goal.CURRENT):
            handle=var.set(None);self.addCleanup(var.reset,handle)
        previous=developer.Progress.latest;developer.Progress.latest=None
        self.addCleanup(setattr,developer.Progress,'latest',previous)

    def run_round(self,replies,sources=None,**options):
        with patch.object(developer,'run_model',side_effect=[('scripted:free'+str(i),reply) for i,reply in enumerate(replies)]):
            return developer.generate_with('fixture','Change value to2',developer.ROOT,sources or SOURCES,EXISTING,'',None,
                                           developer.SMALL,max_attempts=len(replies),**options)

    def test_changed_replacement_and_unrelated_edits_do_not_repeat_patch_dispatch(self):
        with patch.object(developer,'apply_changes',wraps=developer.apply_changes) as dispatch:
            result=self.run_round([answer(),answer(replace='value = 3',extra=True),answer('value = 1')])
        self.assertEqual(dispatch.call_count,2,'Only first rejection and corrected source edit invoke the validator')
        self.assertEqual(result[2],{'value.py':'value = 2\n'})
        self.assertEqual(SOURCES['value.py'],'value = 1\n','Rejected proposal must not mutate input')

    def test_local_receipts_survive_large_to_compact_recovery_without_a_journal(self):
        replies=[('scripted:free'+str(i),answer(replace='value = '+str(i+2))) for i in range(4)]
        replies.append(('scripted:corrected',answer('value = 1')))
        with patch.object(developer,'run_model',side_effect=replies) as model, \
             patch.object(developer,'apply_changes',wraps=developer.apply_changes) as dispatch:
            result=developer.generate('fixture','Change value',developer.ROOT,SOURCES,EXISTING)
        self.assertEqual(result[2],{'value.py':'value = 2\n'})
        self.assertEqual(model.call_count,5);self.assertEqual(dispatch.call_count,2)
        self.assertEqual(model.call_args.kwargs['max_output_tokens'],8192)

    def test_changed_actual_source_or_same_file_prefix_is_new_evidence(self):
        with self.assertRaises(developer.GenerationFailure) as error:
            self.run_round([answer()])
        changed=dict(SOURCES,**{'value.py':'missing\n'})
        result=self.run_round([answer()],changed,prior_anchors=error.exception.rejected_anchors)
        self.assertEqual(result[2],{'value.py':'value = 2\n'})
        first=[dict(find='value = 1',replace='value = 3')]
        fixed=[dict(find='value = 1',replace='value = 2')]
        result=self.run_round([answer('value = 2','value = 4',first),answer('value = 2','value = 4',fixed)])
        self.assertEqual(result[2],{'value.py':'value = 4\n'})

    def test_durable_anchor_survives_journal_rotation_and_restart_without_budget_reset(self):
        world=GitHub();journal=world.journal();journal.checkpoint('a'*40)
        journal.state['budgets'].update(edits=4,modelCalls=9);journal.persist()
        recovery.CURRENT.set(journal)
        with self.assertRaises(developer.GenerationFailure):self.run_round([answer()])
        original=copy.deepcopy(journal.state['budgets'])
        anchors=[r for r in journal.ledger.values() if r.get('operation')=='anchor_receipt']
        self.assertEqual(len(anchors),1);self.assertEqual(anchors[0]['model'],'')
        self.assertNotIn('missing',json.dumps(anchors),'Persist hashes/metadata, not rejected source')
        for i in range(recovery.MAX_EVENTS+2):journal.event('Unrelated diagnostic '+str(i),strategy='fixture')
        restored=world.journal();recovery.CURRENT.set(restored)
        self.assertEqual(restored.state['budgets'],original)
        with patch.object(developer,'apply_changes',wraps=developer.apply_changes) as dispatch:
            result=self.run_round([answer(replace='value = 3',extra=True),answer('value = 1')])
        self.assertEqual(dispatch.call_count,1,'Only the corrected proposal may dispatch after restart')
        self.assertEqual(result[2],{'value.py':'value = 2\n'})
        self.assertEqual(restored.state['budgets']['edits'],original['edits']+1,'Only the corrected retry consumes an edit attempt')
        self.assertEqual(restored.state['budgets']['modelCalls'],original['modelCalls'],'Historical model spend must not reset')
        self.assertEqual(len([r for r in restored.ledger.values() if r.get('operation')=='anchor_receipt']),1)

    def test_exhaustion_retains_receipts_and_does_not_claim_distinct_strategies(self):
        replies=[('scripted:free'+str(i),answer(replace='value = '+str(i+2))) for i in range(5)]
        with patch.object(developer,'run_model',side_effect=replies), \
             patch.object(developer,'apply_changes',wraps=developer.apply_changes) as dispatch, \
             self.assertRaises(developer.GenerationFailure) as error:
            developer.generate('fixture','Change value',developer.ROOT,SOURCES,EXISTING)
        self.assertEqual(error.exception.attempts,5);self.assertEqual(dispatch.call_count,1)
        self.assertEqual(len(error.exception.rejected_anchors),1)
        self.assertNotIn('distinct attempts',str(error.exception))

    def test_compact_transport_failure_does_not_double_count_prior_proposals(self):
        replies=[('scripted:one','bad json'),('scripted:two','bad json'),RuntimeError('Provider offline'),RuntimeError('Provider offline')]
        with patch.object(developer,'run_model',side_effect=replies) as model, self.assertRaises(developer.GenerationFailure) as error:
            developer.generate('fixture','Change value',developer.ROOT,SOURCES,EXISTING)
        self.assertEqual(model.call_count,4)
        self.assertEqual(error.exception.attempts,2,'Two malformed proposals; transport failures are not additional proposals')

    def test_shared_identity_keeps_existing_runtime_checkpoint_keys(self):
        key=edit_identity.anchor_key('app.py',b'value=1\n','missing',[])
        self.assertEqual(key,'49c3fc01cfe53c6ff116a4db315eafa5b5236563822e466c1efaf4e4bd195cd3')
        runtime=sandbox_repair_controller.SandboxRepairController._anchor_key(
            [dict(path='app.py',find='missing',replace='anything')],0,{'app.py':b'value=1\n'})
        self.assertEqual(runtime,key)
        self.assertEqual(recovery.diagnose(developer.RepeatedEditAnchor('docs/authorization.md',key)),('edit_anchor','reread_source'))
