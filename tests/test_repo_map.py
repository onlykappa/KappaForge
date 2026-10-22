"""Repository map: definitions, imports, ranking, rendering, the archive download and the planner hand-off."""
import io
import json
import tarfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from engine import developer, repo_map

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "app/billing.py": "TAX_RATE = 0.2\n\ndef invoice_total(items):\n    return sum(items) * (1 + TAX_RATE)\n\n"
                      "class Ledger:\n    def record(self, amount):\n        return amount\n",
    "app/checkout.py": "from app.billing import invoice_total\n\ndef pay(cart):\n    return invoice_total(cart.items)\n",
    "tests/test_billing.py": "from app import billing\n\ndef test_total():\n    assert billing.invoice_total([10]) == 12\n",
    "web/cart.js": "import {format} from './money.js';\nexport function renderCart(items){return items.map(format)}\n"
                   "export const CART_LIMIT = Object.freeze({max: 5});\nclass CartView {\n  draw(items) {\n    return renderCart(items)\n  }\n}\n",
    "web/money.js": "export function format(value){return '$'+value.toFixed(2)}\n",
    "web/index.html": '<script src="cart.js"></script>',
    "docs/guide.md": "# Billing guide\n## Taxes\nText\n",
    "ios/App.swift": "struct ContentView: View {\n  func refresh() {}\n}\n",
    "app/broken.py": "def oops(:\n",
}


def tarball(files, prefix="owner-repo-abc123/"):
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w:gz") as archive:
        for path, content in files.items():
            raw = content if isinstance(content, bytes) else content.encode()
            info = tarfile.TarInfo(prefix + path)
            info.size = len(raw)
            archive.addfile(info, io.BytesIO(raw))
    return data.getvalue()


class Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class DefinitionTests(unittest.TestCase):
    def test_each_language_lists_what_it_defines(self):
        names = lambda path: [name for name, _, _ in repo_map.definitions(path, SOURCES[path])]
        self.assertEqual(names("app/billing.py"), ["TAX_RATE", "invoice_total", "Ledger", "record"])
        self.assertEqual(names("web/cart.js"), ["renderCart", "CART_LIMIT", "CartView", "draw"])
        self.assertEqual(names("ios/App.swift"), ["ContentView", "refresh"])
        self.assertEqual(names("docs/guide.md"), ["Billing guide", "Taxes"])
        self.assertEqual(names("app/broken.py"), ["oops"], "a file Python cannot parse still shows its definitions")
        signature = repo_map.definitions("app/billing.py", SOURCES["app/billing.py"])[1][1]
        self.assertEqual(signature, "def invoice_total(items):")

    def test_imports_resolve_to_repository_files(self):
        known = set(SOURCES)
        self.assertEqual(repo_map.resolve_imports("app/checkout.py", SOURCES["app/checkout.py"], known), {"app/billing.py"})
        self.assertEqual(repo_map.resolve_imports("tests/test_billing.py", SOURCES["tests/test_billing.py"], known), {"app/billing.py"})
        self.assertEqual(repo_map.resolve_imports("web/cart.js", SOURCES["web/cart.js"], known), {"web/money.js"})
        self.assertEqual(repo_map.resolve_imports("web/index.html", SOURCES["web/index.html"], known), {"web/cart.js"})
        self.assertEqual(repo_map.resolve_imports("x.js", "import x from 'react'; import y from '../../../../nope.js'", known), set())

    def test_words_split_identifiers_and_prose(self):
        self.assertEqual(repo_map.words("getUserName get_user_name HTTPError 402"), ["get", "user", "name", "get", "user", "name", "http", "error", "402"])


class RankingTests(unittest.TestCase):
    def setUp(self):
        self.map = repo_map.RepoMap(SOURCES)

    def test_the_named_function_leads_and_its_callers_and_tests_follow(self):
        order = self.map.rank("Round invoice_total to cents")
        self.assertEqual(order[0], "app/billing.py")
        self.assertLess(order.index("tests/test_billing.py"), 4)
        self.assertLess(order.index("app/checkout.py"), 4)

    def test_task_words_find_files_without_exact_names(self):
        self.assertEqual(self.map.rank("The cart view should draw an empty state")[0], "web/cart.js")
        self.assertLess(self.map.rank("Show money with a currency symbol").index("web/money.js"), 2)

    def test_a_task_with_no_useful_words_still_ranks_every_file(self):
        self.assertEqual(sorted(self.map.rank("please fix it")), sorted(SOURCES))

    def test_render_keeps_to_the_budget_and_leaves_out_skipped_files(self):
        text = self.map.render("invoice_total", budget=10_000, skip={"web/index.html"})
        self.assertTrue(text.startswith("app/billing.py:\n  def invoice_total(items):\n"))
        self.assertNotIn("web/index.html", text)
        short = self.map.render("invoice_total", budget=60)
        self.assertLessEqual(len(short), 60)
        self.assertIn("app/billing.py", short)

    def test_the_map_ranks_kappaforge_itself_sensibly(self):
        files = {p.relative_to(ROOT).as_posix(): p.read_text(errors="replace")
                 for p in ROOT.glob("**/*") if p.is_file() and developer.SOURCE_RE.search(p.name)
                 and not developer.SKIP_RE.search(p.relative_to(ROOT).as_posix() + "/") and ".git/" not in p.as_posix()
                 and not p.relative_to(ROOT).as_posix().startswith(("ios/KappaForge/Web/", "engine/vendor/"))}
        live = repo_map.RepoMap(files)
        top = lambda task, n=8: live.rank(task)[:n]
        self.assertIn("chat-backend/src/neurons.js", top("Count Workers AI Neurons used today on the usage page"))
        self.assertIn("engine/recovery.py", top("The recovery journal should dispatch a continuation once per cooldown"))
        self.assertIn("preview/limits-core.js", top("Provider limits: the quota day should reset at midnight Pacific"))
        self.assertIn("engine/repo_map.py", top("Repository map: rank files with a personalised PageRank"))


class DownloadTests(unittest.TestCase):
    def test_only_wanted_utf8_files_come_out_of_the_archive(self):
        data = tarball({"app/billing.py": SOURCES["app/billing.py"], "app/secret.bin": b"\xff\xfe", "other.py": "x = 1\n"})
        opener = lambda req, timeout: Response(data)
        got = repo_map.download_sources("o/r", "a" * 40, "t", ["app/billing.py", "app/secret.bin"], opener=opener)
        self.assertEqual(got, {"app/billing.py": SOURCES["app/billing.py"]})

    def test_the_request_names_the_exact_commit_and_sends_the_token(self):
        seen = []
        repo_map.download_sources("o/r", "b" * 40, "tok", [], opener=lambda req, timeout: seen.append(req) or Response(tarball({})))
        self.assertEqual(seen[0].full_url, "https://api.github.com/repos/o/r/tarball/" + "b" * 40)
        self.assertEqual(seen[0].get_header("Authorization"), "Bearer tok")

    def test_an_oversized_archive_is_refused(self):
        with patch.object(repo_map, "MAX_DOWNLOAD_BYTES", 10), self.assertRaises(ValueError):
            repo_map.download_sources("o/r", "a" * 40, "t", [], opener=lambda req, timeout: Response(tarball(SOURCES)))


class PlannerTests(unittest.TestCase):
    FILES = {path: len(text) for path, text in SOURCES.items()}

    def test_the_planner_sees_the_map(self):
        with patch.object(developer, "run_model", return_value=("m", json.dumps({"read": ["app/billing.py"]}))) as model:
            paths = developer.select_files("k", "Round invoice_total", self.FILES, repo_map=repo_map.RepoMap(SOURCES))
        prompt = model.call_args.args[1]
        self.assertIn("REPOSITORY MAP", prompt)
        self.assertIn("app/billing.py:\n  def invoice_total(items):", prompt)
        self.assertLess(prompt.index("REPOSITORY MAP"), prompt.index("REPOSITORY FILES"))
        self.assertEqual(paths, ["app/billing.py"])

    def test_without_a_map_the_prompt_is_unchanged(self):
        with patch.object(developer, "run_model", return_value=("m", json.dumps({"read": ["app/billing.py"]}))) as model:
            developer.select_files("k", "Round invoice_total", self.FILES)
        self.assertNotIn("REPOSITORY MAP", model.call_args.args[1])

    def test_an_unusable_planner_answer_falls_back_to_the_ranking(self):
        with patch.object(developer, "run_model", return_value=("m", "not json")):
            paths, stages, design = developer.select_files("k", "Round invoice_total", self.FILES, with_stages=True,
                                                           repo_map=repo_map.RepoMap(SOURCES))
        self.assertEqual(paths[0], "app/billing.py")
        self.assertLessEqual(len(paths), developer.MAP_FALLBACK_FILES)
        self.assertEqual((stages, design), ([], ""))
        with patch.object(developer, "run_model", return_value=("m", "not json")), self.assertRaises(ValueError):
            developer.select_files("k", "Round invoice_total", self.FILES, with_stages=True)

    def test_a_failed_download_means_planning_from_paths(self):
        error = urllib.error.HTTPError("u", 404, "missing", {}, None)
        with patch.object(repo_map, "download_sources", side_effect=error):
            self.assertIsNone(developer.build_repo_map("o/r", "a" * 40, self.FILES, "t"))
        big = dict(self.FILES, **{"ios/KappaForge/Web/app.js": 10, "huge.py": repo_map.MAX_FILE_BYTES + 1})
        with patch.object(repo_map, "download_sources", return_value=SOURCES) as download:
            built = developer.build_repo_map("o/r", "a" * 40, big, "t")
        self.assertNotIn("ios/KappaForge/Web/app.js", download.call_args.args[3])
        self.assertNotIn("huge.py", download.call_args.args[3])
        self.assertEqual(sorted(built.paths), sorted(SOURCES))


if __name__ == "__main__":
    unittest.main()
