import io
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
from engine import runner


class GitHubTransientReadsTests(unittest.TestCase):
    def failure(self, status=502):
        return urllib.error.HTTPError('https://api.github.com/private?token=do-not-log', status,
                                      'untrusted response', {}, io.BytesIO(b'private body'))

    def test_transient_read_retries_and_returns_success(self):
        response = object()
        with patch.object(runner.urllib.request, 'urlopen', side_effect=[self.failure(), self.failure(503), response]) as send, \
                patch.object(runner.time, 'sleep') as sleep:
            self.assertIs(runner.github_response(urllib.request.Request('https://api.github.com/repos/example')), response)
            self.assertEqual(send.call_count, 3)
            self.assertEqual([c.args[0] for c in sleep.call_args_list], [1, 2])

    def test_writes_and_access_errors_are_never_retried(self):
        for method, status in [('POST', 502), ('PATCH', 503), ('DELETE', 504), ('GET', 403), ('GET', 429)]:
            with self.subTest(method=method, status=status), \
                    patch.object(runner.urllib.request, 'urlopen', side_effect=self.failure(status)) as send, \
                    patch.object(runner.time, 'sleep') as sleep:
                with self.assertRaises(urllib.error.HTTPError):
                    runner.github_response(urllib.request.Request('https://api.github.com/repos/example', method=method))
                self.assertEqual(send.call_count, 1)
                sleep.assert_not_called()

    def test_exhausted_read_names_service_without_private_data(self):
        with patch.object(runner.urllib.request, 'urlopen', side_effect=[self.failure() for _ in range(3)]), \
                patch.object(runner.time, 'sleep'):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                runner.github_response(urllib.request.Request('https://api.github.com/private?token=do-not-log'))
        self.assertIn('GET api.github.com', str(caught.exception))
        self.assertIn('3 attempt(s)', str(caught.exception))
        self.assertNotIn('do-not-log', str(caught.exception))
        self.assertNotIn('private', str(caught.exception))
