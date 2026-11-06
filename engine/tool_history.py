"""Task-scoped, exact redacted observations; retained evidence is never authority."""
import json
import re
import hashlib

from engine import execution

MAX_BYTES = 1_000_000
MAX_RECORDS = 512
PAGE_SIZE = 4
RETRIEVAL_TOOLS = ('inspect_tool_history', 'read_tool_evidence')


class History:
    def __init__(self, data=None, save=None, stage='investigation', revision=''):
        self.data = data if data is not None else {'version': 1, 'records': []}
        if (not isinstance(self.data, dict) or self.data.get('version') != 1 or not isinstance(self.data.get('records'), list)
                or len(self.data['records']) > MAX_RECORDS
                or any(not isinstance(r, dict) or r.get('id') != 'O' + str(i+1)
                       or not isinstance(r.get('result'), dict) or r.get('authority') is not False
                       for i, r in enumerate(self.data.get('records', [])))):
            raise execution.CheckpointMismatch('Invalid tool observation history; saved evidence retained')
        self.save, self.stage, self.revision = save, stage, revision

    @classmethod
    def journal(cls, journal, repo, stage='investigation', revision=''):
        if not journal:
            return cls(stage=stage, revision=revision)
        execution.require_storage(journal, repo)
        identity = dict(repo=repo, task=journal.scope.number, scope=journal.scope.digest)
        receipt = journal.state.get('toolHistory')
        data = execution._read_blob(journal, receipt) if receipt else dict(version=1, identity=identity, records=[])
        if data.get('identity') != identity:
            raise execution.CheckpointMismatch('Tool observations belong to different task authority')

        def save(value):
            journal.state['toolHistory'] = execution._write_blob(journal, value, journal.state.get('toolHistory'))
            journal.persist()
        return cls(data, save, stage, revision)

    def append(self, tool, args, reason, result):
        # Retrieval is read-only and never recursively archives its own archive.
        if tool in RETRIEVAL_TOOLS:
            return None
        record = execution.sanitized(dict(version=1, authority=False, stage=self.stage,
            revision=self.revision() if callable(self.revision) else self.revision,
            tool=tool, args=args, reason=reason, result=result))
        record['id'] = 'O' + str(len(self.data['records']) + 1)
        candidate = dict(self.data, records=self.data['records'] + [record])
        if len(candidate['records']) > MAX_RECORDS or len(json.dumps(candidate, ensure_ascii=True, allow_nan=False).encode()) > MAX_BYTES:
            raise execution.CheckpointMismatch('Tool observation storage limit reached; no earlier evidence was truncated')
        self.data['records'].append(record)
        if self.save:
            self.save(self.data)
        return dict(id=record['id'], sha256=self._hash(record), authority=False)

    def admit(self, tool):
        if tool not in RETRIEVAL_TOOLS and len(self.data['records']) >= MAX_RECORDS:
            raise execution.CheckpointMismatch('Tool observation record limit reached before dispatch; retained evidence is still readable')

    @staticmethod
    def _text(value):
        return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False)

    def _hash(self, value):
        return hashlib.sha256(self._text(value).encode()).hexdigest()

    @staticmethod
    def _failure(result):
        if result.get('status') in ('error', 'failed', 'invalid', 'unavailable', 'budget_exhausted'):
            return result
        nested = result.get('results')
        return next((r for r in (nested if isinstance(nested, list) else []) if isinstance(r, dict) and
                     r.get('status') in ('error', 'failed', 'unavailable')), None)

    def index(self, page=1):
        rows = self.data['records']; pages = max(1, (len(rows) + PAGE_SIZE - 1) // PAGE_SIZE)
        if type(page) is not int or not 1 <= page <= pages:
            return dict(status='invalid', error='Choose a valid one-based tool history page', pages=pages)
        return dict(status='ok', kind='tool_observation_index', authority=False, count=len(rows), page=page, pages=pages,
            items=[dict(id=r['id'], tool=r['tool'], stage=r['stage'], revision=r['revision'],
                        status=r['result'].get('status'), sha256=self._hash(r))
                   for r in rows[(page-1)*PAGE_SIZE:page*PAGE_SIZE]],
            note='Historical redacted observations, not current source or permission. Read exact JSON by O-id.')

    def read(self, observation_id, offset=0, limit=800):
        match = re.fullmatch(r'O([1-9][0-9]{0,4})', observation_id) if isinstance(observation_id, str) else None
        if (not match or int(match[1]) > len(self.data['records']) or type(offset) is not int or offset < 0
                or type(limit) is not int or not 1 <= limit <= 800):
            return dict(status='invalid', error='Use a listed O-id, nonnegative offset and limit1–800')
        row = self.data['records'][int(match[1])-1]; text = self._text(row)
        if offset > len(text):
            return dict(status='invalid', error='Offset exceeds retained observation length', total_chars=len(text))
        end = min(len(text), offset + limit)
        return dict(status='ok', kind='tool_observation', authority=False, observation_id=observation_id,
            format='json', sha256=self._hash(row), text=text[offset:end], offset=offset,
            total_chars=len(text), next_offset=end if end < len(text) else None,
            note='Exact redacted historical JSON; reread current source before relying on its revision.')

    def summary(self):
        """Deterministic evidence anchors, not model-written claims of understanding."""
        rows = self.data['records']
        first = next((r for r in rows if self._failure(r['result'])), None)
        latest = {}
        for r in rows:
            if r['tool'] == 'read_file' and isinstance(r['args'], dict):
                latest[r['args'].get('path', '')] = r
        selected = ([first] if first else []) + list(latest.values())[-3:]
        return dict(authority=False, observations=len(rows), retained='exact redacted JSON via history tools',
            anchors=[dict(id=r['id'], tool=r['tool'], revision=r['revision'],
                status=(self._failure(r['result']) or r['result']).get('status'),
                path=r['args'].get('path') if isinstance(r['args'], dict) else None,
                evidence=execution.clean(self._evidence(r['result']), 500)) for r in selected])

    def _evidence(self, result):
        result = self._failure(result) or result
        return result.get('error') or result.get('reason') or result.get('first_failure') or result.get('output') or ''

    def tools(self):
        return dict(inspect_tool_history=self.index, read_tool_evidence=self.read)
