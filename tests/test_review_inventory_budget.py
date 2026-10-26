import json
import os
import unittest
from unittest.mock import patch
from engine import gateway, verify, task_state


class ReviewInventoryBudgetTests(unittest.TestCase):
    def test_large_repository_index_leaves_room_for_doc_evidence_and_task_state(self):
        paths = [f'engine/subsystem_{i:03d}/long_dependency_module_name.py' for i in range(500)]
        path = 'docs/phase3/phase1-phase2-audit.md'
        paths.append(path)
        brief = 'Verify main and Phase 1/2 provenance only. Stop after 3.1a. Never merge.'
        source = '3.1a: inspected main abc123 and Phase 1/2 merge evidence.\n'
        calls = []
        def model(key, prompt, **kwargs):
            self.assertTrue(gateway.prompt_fits(prompt))
            self.assertIn(brief, prompt)
            self.assertIn(source.strip(), prompt)
            self.assertIn('repository paths omitted', prompt)
            calls.append(prompt)
            return 'fixture', json.dumps({'requirements': [], 'problems': [], 'files_needed': [], 'files_to_inspect': []})
        with patch.dict(os.environ, {'KAPPA_ROUTER_REQUIRED': 'true'}), \
                patch.object(task_state, 'add_to_prompt', side_effect=lambda p, j: p + 's' * 6000):
            result = verify.model_review(model, 'key', brief, lambda p: source if p == path else '',
                                         {path: source}, paths)
        self.assertIsNotNone(result)
        self.assertEqual(len(calls), 1)

    def test_index_can_shrink_to_zero_without_dropping_owner_or_source(self):
        prompt = verify.review_prompt('EXACT OWNER BRIEF', 'EXACT DIFF', ['a.py', 'b.py'],
                                      'EXACT SOURCE', inventory_limit=0)
        for text in ['EXACT OWNER BRIEF', 'EXACT DIFF', 'EXACT SOURCE', '2 repository paths omitted']:
            self.assertIn(text, prompt)
