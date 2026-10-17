import unittest
from unittest.mock import MagicMock, patch
import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from chat_backend.src.agent_work import agentWork

class TestAgentWork(unittest.TestCase):
    @patch('chat_backend.src.agent_work.get')
    def test_agent_work_ordering(self, mock_get):
        # Mock GitHub API responses
        mock_get.side_effect = [
            [{'number': 1, 'title': 'Task 1', 'comments': 0}, {'number': 2, 'title': 'Task 2', 'comments': 0}],
            [],
            {'workflow_runs': []},
            {'workflow_runs': []}
        ]
        env = MagicMock()
        result = agentWork(env)
        self.assertIn('Task #1', result)
        self.assertIn('Task #2', result)
        # Verify order is preserved
        self.assertTrue(result.find('Task #1') < result.find('Task #2'))