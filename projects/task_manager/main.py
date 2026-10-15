import json
import os
from datetime import datetime

class TaskManager:
    def __init__(self, filename='tasks.json'):
        self.filename = filename
        self.tasks = self.load_tasks()

    def load_tasks(self):
        if os.path.exists(self.filename):
            with open(self.filename, 'r') as f:
                return json.load(f)
        return []

    def save_tasks(self):
        with open(self.filename, 'w') as f:
            json.dump(self.tasks, f, indent=4)

    def add_task(self, title, priority, deadline):
        task = {'id': len(self.tasks) + 1, 'title': title, 'priority': priority, 'deadline': deadline, 'completed': False}
        self.tasks.append(task)
        self.save_tasks()

    def complete_task(self, task_id):
        for task in self.tasks:
            if task['id'] == task_id:
                task['completed'] = True
                self.save_tasks()
                return True
        return False

    def delete_task(self, task_id):
        self.tasks = [t for t in self.tasks if t['id'] != task_id]
        self.save_tasks()

if __name__ == '__main__':
    tm = TaskManager()
    print("KappaForge Task Manager Initialized.")