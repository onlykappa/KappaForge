import sys
import json
import os

class NotesOrganizer:
    def __init__(self, storage_file='notes.json'):
        self.storage_file = storage_file
        self.notes = self._load()

    def _load(self):
        if os.path.exists(self.storage_file):
            with open(self.storage_file, 'r') as f:
                return json.load(f)
        return {}

    def save(self):
        with open(self.storage_file, 'w') as f:
            json.dump(self.notes, f)

    def add_note(self, title, content):
        self.notes[title] = content
        self.save()

    def get_note(self, title):
        return self.notes.get(title)

def main():
    organizer = NotesOrganizer()
    if len(sys.argv) < 3:
        print("Usage: python main.py [add|get] [title] [content]")
        return

    command = sys.argv[1]
    title = sys.argv[2]

    if command == 'add':
        content = sys.argv[3] if len(sys.argv) > 3 else ""
        organizer.add_note(title, content)
        print(f"Note '{title}' saved.")
    elif command == 'get':
        print(organizer.get_note(title) or "Note not found.")

if __name__ == '__main__':
    main()