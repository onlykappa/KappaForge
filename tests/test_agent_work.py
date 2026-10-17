import unittest
from chat_backend.src.agent_work import short

class TestAgentWork(unittest.TestCase):
    def test_short_strips_comments(self):
        self.assertEqual(short("<!-- comment --> hello", 20), "hello")
        self.assertEqual(short("hello <!-- comment --> world", 20), "hello world")

if __name__ == '__main__':
    unittest.main()