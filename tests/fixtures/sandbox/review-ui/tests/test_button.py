from pathlib import Path
import unittest


class ButtonContract(unittest.TestCase):
    def test_continue_button_is_blue_and_keeps_its_label(self):
        text = Path('index.html').read_text()
        self.assertIn('background: #06c', text)
        self.assertIn('>Continue</button>', text)


if __name__ == '__main__':
    unittest.main()
