"""Phase 2 section 5, live: every host on the research allowlist answers the real tools from a GitHub-hosted runner.

Runs only where KAPPA_RESEARCH_LIVE=1 (.github/workflows/research-live.yml). Each test reads a stable, official page or
registry entry, checks the provenance record, and verifies one claim by literal quote, so a host that stops answering,
changes format or starts redirecting off the allowlist fails here instead of silently degrading research.
"""
import os
import re
import unittest

from engine import research

LIVE = os.getenv('KAPPA_RESEARCH_LIVE') == '1'


@unittest.skipUnless(LIVE, 'live research runs on the GitHub-hosted runner (KAPPA_RESEARCH_LIVE=1)')
class LiveResearchTests(unittest.TestCase):
    def setUp(self):
        self.r = research.Research()

    def assertRetrieved(self, result):
        self.assertEqual(result.get('status'), 'ok', result)
        source = next(s for s in self.r.sources if s['id'] == result['source'])
        self.assertEqual(source['status'], 'ok')
        self.assertRegex(source['retrieved_at'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')
        self.assertRegex(source['sha256'], r'^[0-9a-f]{64}$')
        self.assertTrue(self.r.allowed_host(research.urllib.parse.urlsplit(source.get('final_url') or source['url']).hostname))
        return source

    def cite(self, result, quote):
        verified = self.r.cite_source('live check', result['source'], quote)
        self.assertTrue(verified['verified'], quote)

    def test_docs_python_org_documents_and_flags_deprecations(self):
        page = self.r.read_doc('https://docs.python.org/3/library/json.html')
        self.assertRetrieved(page)
        self.cite(page, 'Serialize obj to a JSON formatted str')
        check = self.r.check_api('https://docs.python.org/3/library/datetime.html', 'datetime.utcnow')
        self.assertRetrieved(check)
        self.assertEqual(check['verdict'], 'deprecated', check.get('evidence'))

    def test_mdn_search_and_pages(self):
        found = self.r.search_docs('Array.prototype.at', 'mdn')
        self.assertRetrieved(found)
        url = next(row['url'] for row in found['results'] if row['url'].endswith('/Array/at'))
        page = self.r.read_doc(url)
        self.assertRetrieved(page)
        self.assertIn('negative', page['text'])

    def test_nodejs_docs_flag_a_deprecated_api_but_not_its_neighbour(self):
        url = 'https://nodejs.org/docs/latest/api/fs.html'
        self.assertEqual(self.r.check_api(url, 'fs.exists(')['verdict'], 'deprecated')
        documented = self.r.check_api(url, 'fs.readFile(')
        self.assertRetrieved(documented)
        self.assertEqual(documented['verdict'], 'documented')

    def test_pypi_reports_yanked_releases(self):
        listed = self.r.package_versions('pypi', 'requests')
        self.assertRetrieved(listed)
        self.assertEqual(listed['flagged'].get('2.32.0'), {'yanked': True})
        self.assertEqual(self.r.compare_version('pypi', 'requests', '2.25.0')['verdict'], 'outdated')

    def test_npm_reports_deprecated_versions_and_searches(self):
        listed = self.r.package_versions('npm', 'left-pad')
        self.assertRetrieved(listed)
        self.assertTrue(all(flags == {'deprecated': True} for flags in listed['flagged'].values()))
        self.assertRetrieved(self.r.search_docs('left-pad', 'npm'))

    def test_github_docs(self):
        page = self.r.read_doc('https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions')
        self.assertRetrieved(page)
        self.assertRegex(page['text'] + ''.join(self.r.read_doc(page['url'], p)['text'] for p in range(2, min(page['pages'], 4) + 1)),
                         r'runs-on')

    def test_cloudflare_workers_docs(self):
        page = self.r.read_doc('https://developers.cloudflare.com/workers/runtime-apis/fetch/')
        self.assertRetrieved(page)
        self.assertIn('fetch', page['text'])

    def test_apple_developer_documentation(self):
        page = self.r.read_doc('https://developer.apple.com/tutorials/data/documentation/swiftui.json')
        self.assertRetrieved(page)
        self.assertIn('SwiftUI', page['text'])

    def test_read_the_docs_search_and_project_pages(self):
        found = self.r.search_docs('project:requests Session', 'readthedocs')
        self.assertRetrieved(found)
        page = self.r.read_doc('https://requests.readthedocs.io/en/latest/user/advanced/')
        self.assertRetrieved(page)
        self.assertTrue(re.search(r'Session Objects', page['text']))

    def test_nothing_reached_a_host_off_the_allowlist(self):
        self.r.read_doc('https://docs.python.org/3/library/json.html')
        self.assertTrue(all(self.r.allowed_host(s['host']) for s in self.r.sources if s['status'] == 'ok'))


if __name__ == '__main__':
    unittest.main()
