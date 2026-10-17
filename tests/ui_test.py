import unittest
from preview.app_dashboard import reviewCardHTML

class TestUI(unittest.TestCase):
    def test_review_card_rendering(self):
        # Test that the card renders without crashing on minimal data
        html = reviewCardHTML('repo#123')
        self.assertIn('review-card', html)

if __name__ == '__main__':
    unittest.main()