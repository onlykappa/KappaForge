import unittest
from unittest.mock import patch

from engine import developer

class AddEngineDeveloperSourceTests(unittest.TestCase):
    def setUp(self):
        # Minimal existing file map with sizes
        self.existing = {
            'engine/developer.py': 5000,
            'other/file.py': 1000,
        }
        self.repo = 'onlykappa/KappaForge'
        self.sha = 'dummysha'
        self.token = 'dummytoken'
        self.content = 'dummy content'

    @patch('engine.developer.read_source')
    def test_adds_when_missing_and_space(self, mock_read):
        mock_read.return_value = self.content
        sources = {}
        result = developer._add_engine_developer_source(sources, self.existing, self.repo, self.sha, self.token)
        self.assertIn('engine/developer.py', result)
        self.assertEqual(result['engine/developer.py'], self.content)
        mock_read.assert_called_once_with(self.repo, 'engine/developer.py', self.sha, self.token)

    def test_no_duplicate_when_already_present(self):
        sources = {'engine/developer.py': 'already'}
        result = developer._add_engine_developer_source(sources, self.existing, self.repo, self.sha, self.token)
        self.assertEqual(result, sources)
        self.assertEqual(result['engine/developer.py'], 'already')

    def test_no_add_when_not_in_existing(self):
        existing = {'other/file.py': 1000}
        sources = {}
        result = developer._add_engine_developer_source(sources, existing, self.repo, self.sha, self.token)
        self.assertNotIn('engine/developer.py', result)
        self.assertEqual(result, {})

    @patch('engine.developer.read_source')
    def test_does_not_read_kappaforge_entrypoint_from_another_repository(self, mock_read):
        sources = {}
        result = developer._add_engine_developer_source(
            sources, self.existing, 'someone/another-repo', self.sha, self.token)
        self.assertEqual(result, sources)
        mock_read.assert_not_called()

    @patch('engine.developer.read_source')
    def test_respects_read_files_limit(self, mock_read):
        mock_read.return_value = self.content
        # Simulate sources already at LARGE.read_files limit
        sources = {f'file{i}.py': '' for i in range(developer.LARGE.read_files)}
        result = developer._add_engine_developer_source(sources, self.existing, self.repo, self.sha, self.token)
        self.assertNotIn('engine/developer.py', result)
        mock_read.assert_not_called()

if __name__ == '__main__':
    unittest.main()
