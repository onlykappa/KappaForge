"""Typed proposal failures keep quoted source out of recovery policy decisions."""


class EditMismatch(ValueError):
    """Keep the failing edit's actual source, including earlier edits in this proposal."""
    def __init__(self, path, find, text, count):
        super().__init__(f"Edit text must match exactly once in {path} (matched {count} times): " + find[:80])
        self.path, self.find, self.text, self.count = path, find, text, count


class SourceNotRead(ValueError):
    def __init__(self, path, overwrite=False):
        message = "Refusing to overwrite a file that was not read: " if overwrite else "Edits target a file that was not read: "
        super().__init__(message + path)
        self.path = path
