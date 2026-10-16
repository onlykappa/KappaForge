import unittest
from projects.example.main import SkipTimer

class TestSkipTimer(unittest.TestCase):
    def test_skip(self):
        timer = SkipTimer(10)
        timer.start()
        self.assertTrue(timer.is_active())
        timer.skip()
        self.assertFalse(timer.is_active())

if __name__ == '__main__':
    unittest.main()