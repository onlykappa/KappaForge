"""No silent loss of owner requirements or wording (KF-AUDIT-004)."""
import unittest
from engine import requirements

class RequirementLimitTests(unittest.TestCase):
    def test_forty_requirements_fail_explicitly_instead_of_losing_ten(self):
        request = '\n'.join(f'{i}. Implement independent requirement number {i}.' for i in range(1, 41))
        with self.assertRaisesRegex(ValueError, r'40.*30.*split'):
            requirements.classify(request)

    def test_long_ask_never_loses_its_final_constraint(self):
        request = 'Implement ' + 'long wording ' * 45 + 'without deleting user files'
        with self.assertRaisesRegex(ValueError, r'characters.*split'):
            requirements.split(request)

    def test_exact_boundary_preserves_original_spans(self):
        request = '\n'.join(f'- Keep requirement {i} unchanged' for i in range(requirements.MAX_REQUIREMENTS))
        rows = requirements.split(request)
        self.assertEqual(len(rows), requirements.MAX_REQUIREMENTS)
        for row in rows:
            self.assertEqual(row['text'], request[row['start']:row['end']])
