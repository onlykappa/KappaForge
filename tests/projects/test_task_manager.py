import unittest
import os
from projects.task_manager.main import TaskManager

class TestTaskManager(unittest.TestCase):
    def setUp(self):
        self.tm = TaskManager('test_tasks.json')

    def tearDown(self):
        if os.path.exists('test_tasks.json'):
            os.remove('test_tasks.json')

    def test_add_task(self):
        self.tm.add_task('Test Task', 'High', '2023-12-31')
        self.assertEqual(len(self.tm.tasks), 1)
        self.assertEqual(self.tm.tasks[0]['title'], 'Test Task')

    def test_complete_task(self):
        self.tm.add_task('Task', 'Low', '2023-01-01')
        self.tm.complete_task(1)
        self.assertTrue(self.tm.tasks[0]['completed'])

    def test_delete_task(self):
        self.tm.add_task('Task', 'Low', '2023-01-01')
        self.tm.delete_task(1)
        self.assertEqual(len(self.tm.tasks), 0)

if __name__ == '__main__':
    unittest.main()