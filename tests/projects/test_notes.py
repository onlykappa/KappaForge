import unittest
import os
from projects.example.main import NotesOrganizer

class TestNotesOrganizer(unittest.TestCase):
    def setUp(self):
        self.test_file = 'test_notes.json'
        self.organizer = NotesOrganizer(self.test_file)

    def tearDown(self):
        if os.path.exists(self.test_file):
            os.remove(self.test_file)

    def test_add_and_get(self):
        self.organizer.add_note('test', 'hello world')
        self.assertEqual(self.organizer.get_note('test'), 'hello world')

    def test_missing_note(self):
        self.assertIsNone(self.organizer.get_note('ghost'))

if __name__ == '__main__':
    unittest.main()