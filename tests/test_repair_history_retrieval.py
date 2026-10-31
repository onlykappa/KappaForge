"""Exact historic hypotheses remain reachable without expanding every model prompt."""
import hashlib
import json
import unittest
from engine import repair_history, tool_loop


def histories(count=16):
    return [dict(cause=('Original diagnosis ' + chr(65 + n) + ' ') * 40,
        strategy=('Distinct mechanism ' + chr(65 + n) + ' ') * 40,
        expected_result='Unchanged acceptance tests pass', differs_from='Earlier mechanism failed',
        evidence=[dict(path='app.py', line=1)], family='Earlier failing test',
        revision=str(n % 10) * 64, patch='candidate-' + str(n)) for n in range(count)]


class RepairHistoryRetrievalTests(unittest.TestCase):
    def test_old_record_reconstructs_exactly_from_bounded_pages(self):
        plans = histories()
        self.assertGreater(len(json.dumps(plans)), 30000)
        listing = repair_history.index(plans, [dict(fingerprint='candidate-0', status='failed')])
        self.assertEqual(listing['items'][0]['id'], 'R1')
        self.assertEqual(listing['items'][0]['candidate_result'], 'failed')
        text = ''; offset = 0; digest = None
        while True:
            page = repair_history.read(plans, 'R1', offset)
            self.assertEqual(tool_loop._bounded_result(page), page, 'Transport must not silently clip a requested slice')
            self.assertFalse(page['authority'])
            text += page['text']; digest = page['sha256']
            offset = page['next_offset']
            if offset is None: break
        self.assertEqual(json.loads(text), plans[0])
        self.assertEqual(hashlib.sha256(text.encode()).hexdigest(), digest)

    def test_adversarial_escaping_fits_the_actual_tool_transport(self):
        plans = histories(1); plans[0]['cause'] = '\\"' * 600
        offset = 0; chunks = []
        while True:
            page = repair_history.read(plans, 'R1', offset)
            self.assertEqual(tool_loop._bounded_result(page), page)
            chunks.append(page['text']); offset = page['next_offset']
            if offset is None: break
        self.assertEqual(json.loads(''.join(chunks)), plans[0])

    def test_invalid_ids_offsets_and_pages_never_fabricate_history(self):
        plans = histories(1)
        for plan_id, offset, limit in [('R0',0,800),('R2',0,800),('../R1',0,800),('R1',True,800),('R1',0,801),('R1',999999,800)]:
            self.assertEqual(repair_history.read(plans,plan_id,offset,limit)['status'],'invalid')
        for page in (True,0,2,'latest'):
            self.assertEqual(repair_history.index(plans,[],page)['status'],'invalid')
        self.assertEqual(repair_history.index([],[])['items'], [])
