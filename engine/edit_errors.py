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


class GenerationFailure(ValueError):
    """Rejected proposals are recoverable without treating scope failures as transport errors."""
    def __init__(self, message, compact=False, provider_routes=False, retry_at=0, terminal=False, blocked=False, attempts=0, errors=(), rejected_proposals=()):
        super().__init__(message)
        self.compact = compact
        self.blocked = blocked
        self.provider_routes = provider_routes
        self.retry_at, self.terminal = retry_at, terminal
        self.attempts = attempts
        self.errors = tuple(errors)
        self.rejected_proposals = tuple(rejected_proposals)
