"""Durable spend of a task's bounded investigation budgets, so a resumed task never regains them.

The planning investigation, the sandbox repair loop's exploration and documentation research each have a budget
(calls or fetches, time, output, context or bytes). Within one run the tools count what they spend; this ledger keeps
the task's total across runs in the recovery journal (`budgetSpent`). A new run starts from the saved total, not
from zero.

Each call or fetch is recorded twice. It is recorded as spent before it runs, so a run that dies mid-call has already
paid for it. Its output, bytes and time are recorded as soon as it returns. The only thing a crash can lose is the
time and output of the one call in flight, and the call itself still counts.
"""

KINDS = ('investigation', 'repairExploration', 'research')


class Ledger:
    def __init__(self, journal, kind):
        if kind not in KINDS:
            raise ValueError('unknown budget ledger: ' + str(kind))
        self.journal, self.kind = journal, kind
        saved = ((getattr(journal, 'state', None) or {}).get('budgetSpent') or {}).get(kind)
        # Only non-negative numbers are trusted; anything else counts as nothing spent for that key, never as credit.
        self.prior = {key: value for key, value in (saved.items() if isinstance(saved, dict) else ())
                      if isinstance(key, str) and type(value) in (int, float) and value >= 0}
        self.totals = dict(self.prior)

    def spent(self, key):
        """What earlier runs of this task spent on `key`."""
        return self.prior.get(key, 0)

    def record(self, totals, flush=True):
        """The task's totals so far (earlier runs included). Totals never go down."""
        self.totals = {key: max(value, self.totals.get(key, 0)) for key, value in totals.items()}
        if flush:
            self.flush()

    def flush(self):
        if self.journal is None:
            return
        rounded = {key: round(value, 3) if isinstance(value, float) else value for key, value in self.totals.items()}
        spent = dict(self.journal.state.get('budgetSpent') or {})
        if spent.get(self.kind) == rounded:
            return
        spent[self.kind] = rounded
        self.journal.state['budgetSpent'] = spent
        self.journal.persist()
