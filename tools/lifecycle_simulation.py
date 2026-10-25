"""Whole development tasks, easy to complex, through the real engine and the real coding gateway.

Only GitHub is simulated: an in-memory repository keeps real commit and branch history and records every write in
order, so the PR lifecycle can be checked exactly (the draft opens with the goal and plan before any code, stays a
draft, is never merged, main never moves). Planning, staged writing, self-review and repair run for real and every
model call goes through the production gateway, whose token usage is recorded. A real GitHub request is refused.

The code left on each draft is then judged in the networkless, credential-free sandbox containers of
tools.multi_agent_check: once with the tests the AI wrote, once with hidden acceptance tests it never saw.

    python -m tools.lifecycle_simulation [--only easy,medium,complex] [--out report.json]

The process fails when a lifecycle rule is broken or the harness itself errs; how well the models did is reported,
not hidden, in the report and the printed summary.
"""
import argparse
import base64
import hashlib
import json
import os
import re
import sys
import textwrap
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request

from engine import developer, gateway, intent_guard, projects, runner
from engine import repo_map as repo_maps
from engine.developer import ROOT
from tools import multi_agent_check

OWNER = "onlykappa"
REAL_URLOPEN = urllib.request.urlopen
GITHUB_HOSTS = ("api.github.com", "github.com", "codeload.github.com", "uploads.github.com")


class RealGitHubBlocked(PermissionError):
    pass


def http_error(path, code):
    return urllib.error.HTTPError("https://api.github.com/" + path, code, "simulated", {}, None)


class SimGitHub:
    """One repository plus the task's issue on KappaForge, in memory. Unknown calls are refused, never sent."""

    def __init__(self, repo, number, title, files, issue=None):
        self.repo, self.number, self.title = repo, number, title
        self.issue = issue or {"number": number, "title": title, "state": "open", "user": {"login": OWNER}, "body": ""}
        self.counter = 0
        self.trees = {}
        self.commits = {}
        base_tree = self._tree(dict(files))
        self.base = self._commit({"tree": base_tree, "parents": [], "message": "Initial project"})
        self.refs = {"main": self.base}
        self.prs, self.comments, self.events, self.dispatches, self.refused = {}, {}, [], [], []
        self.opened_body = None
        self.pr_comments = {}

    # ---- storage --------------------------------------------------------------------------------------------
    def _sha(self, kind):
        self.counter += 1
        return hashlib.sha1(f"{self.repo}:{kind}:{self.counter}".encode()).hexdigest()

    def _tree(self, files):
        sha = self._sha("tree")
        self.trees[sha] = files
        return sha

    def _commit(self, commit):
        sha = self._sha("commit")
        self.commits[sha] = commit
        return sha

    def files_at(self, sha):
        return self.trees[self.commits[sha]["tree"]] if sha in self.commits else self.trees[sha]

    def descends(self, sha, ancestor):
        seen, stack = set(), [sha]
        while stack:
            current = stack.pop()
            if current == ancestor:
                return True
            if current not in seen and current in self.commits:
                seen.add(current)
                stack.extend(self.commits[current]["parents"])
        return False

    def event(self, kind, **detail):
        self.events.append({"n": len(self.events), "t": round(time.time(), 1), "kind": kind, **detail})

    def changed(self, sha):
        base, head = self.files_at(self.refs["main"]), self.files_at(sha)
        return sorted(p for p in set(base) | set(head) if base.get(p) != head.get(p))

    def download(self, repo, sha, token, paths, opener=None):
        if repo != self.repo:
            raise RealGitHubBlocked("Simulation only serves its own repository")
        files = self.files_at(sha)
        return {p: files[p] for p in paths if p in files}

    # ---- the GitHub REST surface the engine uses ------------------------------------------------------------
    def gh(self, path, token, payload=None, method=None):
        method = method or ("POST" if payload is not None else "GET")
        route, _, query = path.partition("?")
        repo = f"repos/{self.repo}"
        issue = f"repos/{ROOT}/issues/{self.number}"
        if route == repo and method == "GET":
            return {"full_name": self.repo, "default_branch": "main", "private": True}
        if route == f'repos/{ROOT}' and method == 'GET':
            return {'full_name': ROOT, 'private': True}  # The isolated fixture's task tracker can hold its private code.
        m = re.fullmatch(re.escape(repo) + r"/git/ref/heads/(.+)", route)
        if m and method == "GET":
            if m.group(1) not in self.refs:
                raise http_error(path, 404)
            return {"object": {"sha": self.refs[m.group(1)]}}
        m = re.fullmatch(re.escape(repo) + r"/git/trees/([0-9a-f]{40})", route)
        if m and method == "GET":
            return {"truncated": False, "tree": [{"path": p, "type": "blob", "mode": "100644", "size": len(t.encode())}
                                                 for p, t in sorted(self.files_at(m.group(1)).items())]}
        m = re.fullmatch(re.escape(repo) + r"/contents/(.+)", route)
        if m and method == "GET":
            ref = dict(part.split("=", 1) for part in query.split("&") if "=" in part).get("ref", self.refs["main"])
            name = urllib.parse.unquote(m.group(1))
            files = self.files_at(ref)
            if name not in files:
                raise http_error(path, 404)
            return {"encoding": "base64", "content": base64.b64encode(files[name].encode()).decode()}
        m = re.fullmatch(re.escape(repo) + r"/git/commits/([0-9a-f]{40})", route)
        if m and method == "GET":
            if m.group(1) not in self.commits:
                raise http_error(path, 404)
            return {"sha": m.group(1), "tree": {"sha": self.commits[m.group(1)]["tree"]}}
        if route == repo + "/git/trees" and method == "POST":
            files = dict(self.trees[payload["base_tree"]])
            for entry in payload["tree"]:
                if entry.get("sha", "") is None:
                    files.pop(entry["path"], None)
                else:
                    files[entry["path"]] = entry["content"]
            return {"sha": self._tree(files)}
        if route == repo + "/git/commits" and method == "POST":
            if payload["tree"] not in self.trees or any(p not in self.commits for p in payload["parents"]):
                raise http_error(path, 422)
            sha = self._commit({"tree": payload["tree"], "parents": list(payload["parents"]), "message": payload["message"]})
            parent = self.files_at(payload["parents"][0]) if payload["parents"] else {}
            touched = sorted(p for p in set(parent) | set(self.trees[payload["tree"]]) if parent.get(p) != self.trees[payload["tree"]].get(p))
            self.event("commit", sha=sha[:12], files=touched, message=payload["message"].splitlines()[0][:120])
            return {"sha": sha}
        if route == repo + "/git/refs" and method == "POST":
            name = payload["ref"].removeprefix("refs/heads/")
            if name in self.refs or payload["sha"] not in self.commits:
                raise http_error(path, 422)
            self.refs[name] = payload["sha"]
            self.event("branch_created", branch=name, sha=payload["sha"][:12])
            return {"ref": payload["ref"], "object": {"sha": payload["sha"]}}
        m = re.fullmatch(re.escape(repo) + r"/git/refs/heads/(.+)", route)
        if m and method == "PATCH":
            name = m.group(1)
            if name == "main":
                self.event("violation", rule="main_moved")
                raise http_error(path, 403)
            if name not in self.refs or (not payload.get("force") and not self.descends(payload["sha"], self.refs[name])):
                raise http_error(path, 422)
            self.refs[name] = payload["sha"]
            self.event("branch_updated", branch=name, sha=payload["sha"][:12], files=self.changed(payload["sha"]))
            return {"object": {"sha": payload["sha"]}}
        if m and method == "DELETE":
            self.refs.pop(m.group(1), None)
            self.event("branch_deleted", branch=m.group(1))
            return {}
        if route == repo + "/pulls" and method == "POST":
            number = 100 + len(self.prs) + 1
            head = payload["head"]
            pr = {"number": number, "html_url": f"https://github.com/{self.repo}/pull/{number}", "state": "open",
                  "draft": payload.get("draft") is True, "title": payload["title"], "body": payload.get("body", ""),
                  "head": {"ref": head, "sha": self.refs.get(head), "repo": {"full_name": self.repo}}, "base": {"ref": payload["base"]}}
            self.prs[number] = pr
            self.event("pr_opened", number=number, draft=pr["draft"], files=self.changed(self.refs[head]),
                       record=developer.requirements_open(pr), goal_and_plan="## Goal" in pr["body"] and "## Plan" in pr["body"])
            self.opened_body = pr["body"]
            return dict(pr)
        if route == repo + "/pulls" and method == "GET":
            head = dict(part.split("=", 1) for part in query.split("&") if "=" in part).get("head", "").split(":")[-1]
            return [self._pr(pr) for pr in self.prs.values() if pr["state"] == "open" and (not head or pr["head"]["ref"] == head)]
        m = re.fullmatch(re.escape(repo) + r"/pulls/(\d+)(/files|/merge)?", route)
        if m:
            pr = self.prs.get(int(m.group(1)))
            if not pr:
                raise http_error(path, 404)
            if m.group(2) == "/files":
                return [{"filename": p, "status": "modified"} for p in self.changed(self.refs[pr["head"]["ref"]])]
            if m.group(2) == "/merge":
                self.event("violation", rule="merge_attempted", number=pr["number"])
                raise http_error(path, 403)
            if method == "PATCH":
                if "draft" in payload and payload["draft"] is not True:
                    self.event("violation", rule="draft_marked_ready", number=pr["number"])
                pr.update({k: v for k, v in payload.items() if k in ("title", "body", "draft", "state")})
                self.event("pr_updated", number=pr["number"], fields=sorted(payload), record=developer.requirements_open(pr))
            return self._pr(pr)
        m = re.fullmatch(re.escape(repo) + r"/issues/(\d+)/comments", route)
        if m and int(m.group(1)) in self.prs:
            if method == "GET":
                return [{"id": cid, "body": body} for cid, body in self.pr_comments.get(int(m.group(1)), [])]
            self.pr_comments.setdefault(int(m.group(1)), []).append((7000 + len(self.pr_comments), payload["body"]))
            self.event("pr_comment", number=int(m.group(1)), first_line=payload["body"].splitlines()[0][:120])
            return {"id": 7000 + len(self.pr_comments)}
        if route == issue + "/comments" and method == "GET":
            return [{"id": cid, "body": body, "user": {"login": "github-actions[bot]"}} for cid, body in self.comments.items()]
        if route == issue + "/comments" and method == "POST":
            cid = 5000 + len(self.comments)
            self.comments[cid] = payload["body"]
            self.event("comment", id=cid, first_line=payload["body"].splitlines()[0][:120])
            return {"id": cid}
        m = re.fullmatch(rf"repos/{re.escape(ROOT)}/issues/comments/(\d+)", route)
        if m and method == "PATCH" and int(m.group(1)) in self.comments:
            self.comments[int(m.group(1))] = payload["body"]
            return {"id": int(m.group(1))}
        if route == issue and method == "GET":
            return dict(self.issue)  # The journal re-checks before each model call that the task is unchanged and open.
        m = re.fullmatch(rf"repos/{re.escape(ROOT)}/actions/workflows/([\w.-]+)/(dispatches|runs)", route)
        if m:
            if m.group(2) == "runs":
                return {"workflow_runs": []}
            self.dispatches.append({"workflow": m.group(1), "inputs": payload.get("inputs", {})})
            self.event("checks_requested", workflow=m.group(1), sha=str(payload.get("inputs", {}).get("candidate_sha", ""))[:12])
            return {}
        self.refused.append(f"{method} {path}")
        raise RealGitHubBlocked(f"Simulation refused an unexpected GitHub call: {method} {route}")

    def _pr(self, pr):
        return {**pr, "head": {**pr["head"], "sha": self.refs.get(pr["head"]["ref"], pr["head"]["sha"])}}


# ---- scenarios ---------------------------------------------------------------------------------------------------
def dedent(text):
    return textwrap.dedent(text).lstrip("\n")


SCENARIOS = [
    {
        "key": "easy", "number": 9101, "title": "Add Fahrenheit and Kelvin conversions",
        "task": ("Add fahrenheit_to_celsius(fahrenheit) and celsius_to_kelvin(celsius) to units/convert.py, next to "
                 "celsius_to_fahrenheit. Both must raise ValueError for temperatures below absolute zero (-459.67 °F, "
                 "-273.15 °C). Add tests for normal values and for the errors in tests/test_convert.py."),
        "files": {
            "README.md": "# units\n\nSmall, pure temperature conversion helpers.\n",
            "KAPPA.md": "Test command: python -m unittest discover -s tests -t .\nKeep functions pure, with a docstring each.\n",
            "units/__init__.py": "",
            "units/convert.py": dedent('''
                """Temperature conversions."""


                def celsius_to_fahrenheit(celsius):
                    """Degrees Celsius to degrees Fahrenheit."""
                    return celsius * 9 / 5 + 32
                '''),
            "tests/__init__.py": "",
            "tests/test_convert.py": dedent('''
                import unittest

                from units.convert import celsius_to_fahrenheit


                class CelsiusToFahrenheit(unittest.TestCase):
                    def test_boiling_point(self):
                        self.assertEqual(celsius_to_fahrenheit(100), 212)
                '''),
        },
        "hidden": {
            "tests/test_zz_acceptance_hidden.py": dedent('''
                import unittest

                from units import convert


                class Acceptance(unittest.TestCase):
                    def test_fahrenheit_to_celsius(self):
                        self.assertAlmostEqual(convert.fahrenheit_to_celsius(212), 100)
                        self.assertAlmostEqual(convert.fahrenheit_to_celsius(32), 0)
                        self.assertAlmostEqual(convert.fahrenheit_to_celsius(-40), -40)
                        self.assertAlmostEqual(convert.fahrenheit_to_celsius(98.6), 37, places=6)
                        self.assertAlmostEqual(convert.fahrenheit_to_celsius(-459.67), -273.15, places=6)

                    def test_celsius_to_kelvin(self):
                        self.assertAlmostEqual(convert.celsius_to_kelvin(0), 273.15)
                        self.assertAlmostEqual(convert.celsius_to_kelvin(-273.15), 0)
                        self.assertAlmostEqual(convert.celsius_to_kelvin(26.85), 300, places=6)

                    def test_below_absolute_zero_is_rejected(self):
                        for call, value in ((convert.fahrenheit_to_celsius, -459.68), (convert.celsius_to_kelvin, -273.16),
                                            (convert.fahrenheit_to_celsius, -1000), (convert.celsius_to_kelvin, -500)):
                            with self.assertRaises(ValueError):
                                call(value)

                    def test_existing_conversion_is_unchanged(self):
                        self.assertEqual(convert.celsius_to_fahrenheit(100), 212)
                        self.assertEqual(convert.celsius_to_fahrenheit(-40), -40)
                '''),
        },
    },
    {
        "key": "medium", "number": 9102, "title": "Cart subtotal validation, discount codes and tax",
        "task": dedent('''
            Extend the shopping cart in web/cart.js. Keep total(cart) working exactly as it does now, and add and export:
            1. subtotal(cart): the same sum as total(), but throw a TypeError when any line's priceCents or qty is not a
               non-negative integer (so 1.5, -1, "2" and NaN are all rejected).
            2. applyDiscount(cart, code): returns the cart's subtotal in cents after the discount. Codes are
               case-insensitive and surrounding whitespace is ignored. SAVE10 takes 10% off, rounded to the nearest
               cent with Math.round. FREESHIP leaves out every line whose sku is "shipping". Any other code throws an
               Error whose message contains the code as given.
            3. withTax(cents, ratePercent): returns cents plus tax, where tax is cents * ratePercent / 100 rounded with
               Math.round. A negative rate or negative cents throws a RangeError.
            Add tests for every rule above to web/cart.test.mjs.
            '''),
        "files": {
            "package.json": json.dumps({"name": "cart", "private": True, "type": "module"}, indent=2) + "\n",
            "KAPPA.md": "Test command: node --test web/\nPlain ES modules, no dependencies.\n",
            "web/cart.js": dedent('''
                // Cart lines look like {sku: "tea", priceCents: 250, qty: 2}.
                export function total(cart) {
                  return cart.reduce((sum, line) => sum + line.priceCents * line.qty, 0);
                }
                '''),
            "web/cart.test.mjs": dedent('''
                import test from 'node:test';
                import assert from 'node:assert/strict';
                import {total} from './cart.js';

                test('total adds every line', () => {
                  assert.equal(total([{sku: 'tea', priceCents: 250, qty: 2}, {sku: 'mug', priceCents: 100, qty: 1}]), 600);
                });
                '''),
        },
        "hidden": {
            "web/zz-acceptance.hidden.test.mjs": dedent('''
                import test from 'node:test';
                import assert from 'node:assert/strict';
                import {total, subtotal, applyDiscount, withTax} from './cart.js';

                const cart = [{sku: 'tea', priceCents: 999, qty: 1}, {sku: 'shipping', priceCents: 500, qty: 1}];

                test('total is unchanged', () => assert.equal(total(cart), 1499));
                test('subtotal sums valid lines', () => assert.equal(subtotal(cart), 1499));
                test('subtotal rejects invalid lines', () => {
                  for (const bad of [1.5, -1, '2', NaN]) {
                    assert.throws(() => subtotal([{sku: 'x', priceCents: bad, qty: 1}]), TypeError);
                    assert.throws(() => subtotal([{sku: 'x', priceCents: 100, qty: bad}]), TypeError);
                  }
                });
                test('SAVE10 rounds to the nearest cent', () => {
                  assert.equal(applyDiscount(cart, 'SAVE10'), Math.round(1499 * 0.9));
                  assert.equal(applyDiscount([{sku: 'a', priceCents: 995, qty: 1}], 'SAVE10'), 896);
                });
                test('codes ignore case and whitespace', () => assert.equal(applyDiscount(cart, '  save10 '), 1349));
                test('FREESHIP drops shipping lines', () => assert.equal(applyDiscount(cart, 'freeship'), 999));
                test('unknown codes name the code', () => assert.throws(() => applyDiscount(cart, 'BOGUS7'), /BOGUS7/));
                test('withTax rounds the tax', () => {
                  assert.equal(withTax(1000, 8.25), 1083);
                  assert.equal(withTax(199, 7), 213);
                  assert.equal(withTax(0, 10), 0);
                });
                test('withTax rejects negatives', () => {
                  assert.throws(() => withTax(100, -1), RangeError);
                  assert.throws(() => withTax(-1, 5), RangeError);
                });
                '''),
        },
    },
    {
        "key": "complex", "number": 9103, "title": "Inventory removals, audit history, CSV and history reports, cart discounts",
        "task": dedent('''
            Open a fresh draft PR first with the plan, keep it as a draft, and notify me when it is ready for review.

            Make these changes to the inventory project:
            1. inventory/store.py: add Store.remove(sku, qty). It lowers the item's quantity. Raise KeyError for an unknown
               sku, and ValueError when qty is not a positive int or is more than the stock. When the quantity reaches 0 the
               item is removed from the store entirely.
            2. inventory/store.py: add Store.low_stock(threshold) returning the items whose qty is below threshold, sorted
               by sku.
            3. inventory/store.py: keep an audit history. Every successful add or remove appends a tuple
               (action, sku, qty) to Store.history, in order, with action "add" or "remove". A failed operation appends
               nothing and changes nothing.
            4. inventory/report.py: add csv_report(items) returning CSV text: a header line sku,name,qty,price, then one
               line per item sorted by sku, with price in dollars with exactly two decimals from price_cents. Fields that
               contain a comma, a double quote or a newline are wrapped in double quotes, with inner quotes doubled.
               Lines end with "\\n".
            5. inventory/report.py: add history_report(store) returning one line per history entry, "<n>. <action> <sku> x<qty>",
               numbered from 1 and joined with "\\n" (an empty history gives "").
            6. web/cart.js: add and export applyDiscount(cart, code): SAVE10 takes 10% off the total rounded with
               Math.round, FREESHIP leaves out lines whose sku is "shipping", any other code throws an Error. Also add and
               export itemCount(cart) returning the total quantity.
            Test every feature: Python in tests/test_store.py and a new tests/test_report.py, JavaScript in web/cart.test.mjs.
            '''),
        "files": {
            "README.md": "# inventory\n\nA small stock-keeping library with a web cart.\n",
            "KAPPA.md": dedent('''
                Test command: python -m unittest discover -s tests -t . && node --test web/
                Python 3.12, standard library only. JavaScript is plain ES modules.
                '''),
            "package.json": json.dumps({"name": "inventory-web", "private": True, "type": "module"}, indent=2) + "\n",
            "inventory/__init__.py": "",
            "inventory/models.py": dedent('''
                from dataclasses import dataclass


                @dataclass
                class Item:
                    sku: str
                    name: str
                    qty: int
                    price_cents: int
                '''),
            "inventory/store.py": dedent('''
                from inventory.models import Item


                class Store:
                    def __init__(self):
                        self.items = {}

                    def add(self, item: Item):
                        if item.qty < 0:
                            raise ValueError("qty must not be negative")
                        existing = self.items.get(item.sku)
                        if existing:
                            existing.qty += item.qty
                        else:
                            self.items[item.sku] = item

                    def get(self, sku):
                        return self.items.get(sku)
                '''),
            "inventory/report.py": dedent('''
                def text_report(items):
                    lines = [f"{i.sku}: {i.name} x{i.qty}" for i in sorted(items, key=lambda i: i.sku)]
                    return "\\n".join(lines)
                '''),
            "tests/__init__.py": "",
            "tests/test_store.py": dedent('''
                import unittest

                from inventory.models import Item
                from inventory.store import Store


                class StoreTests(unittest.TestCase):
                    def test_add_merges_quantities(self):
                        s = Store()
                        s.add(Item("a", "Apple", 2, 50))
                        s.add(Item("a", "Apple", 3, 50))
                        self.assertEqual(s.get("a").qty, 5)
                '''),
            "web/cart.js": dedent('''
                export function total(cart) {
                  return cart.reduce((sum, line) => sum + line.priceCents * line.qty, 0);
                }
                '''),
            "web/cart.test.mjs": dedent('''
                import test from 'node:test';
                import assert from 'node:assert/strict';
                import {total} from './cart.js';

                test('total adds lines', () => {
                  assert.equal(total([{priceCents: 250, qty: 2}, {priceCents: 100, qty: 1}]), 600);
                });
                '''),
        },
        "hidden": {
            "tests/test_zz_acceptance_hidden.py": dedent('''
                import unittest

                from inventory.models import Item
                from inventory.report import csv_report, history_report, text_report
                from inventory.store import Store


                def stocked():
                    s = Store()
                    s.add(Item("b", "Banana", 5, 25))
                    s.add(Item("a", "Apple", 2, 50))
                    return s


                class StoreAcceptance(unittest.TestCase):
                    def test_remove_lowers_and_deletes_at_zero(self):
                        s = stocked()
                        s.remove("b", 2)
                        self.assertEqual(s.get("b").qty, 3)
                        s.remove("a", 2)
                        self.assertIsNone(s.get("a"))
                        self.assertNotIn("a", s.items)

                    def test_remove_rejects_bad_requests_without_changes(self):
                        s = stocked()
                        with self.assertRaises(KeyError):
                            s.remove("zz", 1)
                        for qty in (0, -1, 6, 1.5):
                            with self.assertRaises(ValueError):
                                s.remove("b", qty)
                        self.assertEqual(s.get("b").qty, 5)
                        self.assertEqual(s.history, [("add", "b", 5), ("add", "a", 2)])

                    def test_low_stock_is_sorted_and_strict(self):
                        s = stocked()
                        s.add(Item("c", "Cherry", 1, 10))
                        self.assertEqual([i.sku for i in s.low_stock(3)], ["a", "c"])
                        self.assertEqual(s.low_stock(1), [])

                    def test_history_records_successes_in_order(self):
                        s = stocked()
                        s.remove("b", 1)
                        self.assertEqual(s.history, [("add", "b", 5), ("add", "a", 2), ("remove", "b", 1)])


                class ReportAcceptance(unittest.TestCase):
                    def test_csv_report_formats_and_quotes(self):
                        items = [Item("b", 'Big "Box"', 1, 1999), Item("a", "Apple, red", 2, 5)]
                        self.assertEqual(csv_report(items),
                                         'sku,name,qty,price\\na,"Apple, red",2,0.05\\nb,"Big ""Box""",1,19.99\\n')

                    def test_csv_report_of_nothing_is_the_header(self):
                        self.assertEqual(csv_report([]), "sku,name,qty,price\\n")

                    def test_history_report(self):
                        s = stocked()
                        s.remove("a", 1)
                        self.assertEqual(history_report(s), "1. add b x5\\n2. add a x2\\n3. remove a x1")
                        self.assertEqual(history_report(Store()), "")

                    def test_text_report_is_unchanged(self):
                        self.assertEqual(text_report(stocked().items.values()), "a: Apple x2\\nb: Banana x5")
                '''),
            "web/zz-acceptance.hidden.test.mjs": dedent('''
                import test from 'node:test';
                import assert from 'node:assert/strict';
                import {total, applyDiscount, itemCount} from './cart.js';

                const cart = [{sku: 'tea', priceCents: 999, qty: 2}, {sku: 'shipping', priceCents: 500, qty: 1}];
                test('total is unchanged', () => assert.equal(total(cart), 2498));
                test('SAVE10', () => assert.equal(applyDiscount(cart, 'SAVE10'), Math.round(2498 * 0.9)));
                test('FREESHIP', () => assert.equal(applyDiscount(cart, 'FREESHIP'), 1998));
                test('unknown code', () => assert.throws(() => applyDiscount(cart, 'NOPE'), Error));
                test('itemCount', () => {
                  assert.equal(itemCount(cart), 3);
                  assert.equal(itemCount([]), 0);
                });
                '''),
        },
    },
]


# ---- running one scenario ----------------------------------------------------------------------------------------
def guarded_urlopen(req, *args, **kwargs):
    url = req.full_url if hasattr(req, "full_url") else str(req)
    host = urllib.parse.urlsplit(url).hostname or ""
    if host in GITHUB_HOSTS or host.endswith(".github.com"):
        raise RealGitHubBlocked("Simulation refused a real GitHub request to " + host)
    return REAL_URLOPEN(req, *args, **kwargs)


def lifecycle_checks(sim, url=None):
    """The PR rules: publish only after candidate code is committed, stay draft, never merge, keep main fixed."""
    events = sim.events
    opened = [e for e in events if e["kind"] == "pr_opened"]
    code = [e for e in events if e["kind"] == "commit" and e["files"]]
    checks = {
        "one_draft_opened": len(opened) == 1 and opened[0]["draft"],
        "published_after_candidate_commit": bool(opened and code) and code[-1]["n"] < opened[0]["n"],
        "plan_shows_goal_and_plan": False,
        "stays_draft": not any(e["kind"] == "violation" and e["rule"] == "draft_marked_ready" for e in events),
        "never_merged": not any(e["kind"] == "violation" and e["rule"] == "merge_attempted" for e in events),
        "main_never_moved": sim.refs["main"] == sim.base and not any(e.get("rule") == "main_moved" for e in events),
        "no_real_github_calls": not sim.refused,
    }
    if opened:
        checks["stays_draft"] = checks["stays_draft"] and all(pr["draft"] for pr in sim.prs.values())
        checks["plan_shows_goal_and_plan"] = opened[0]["goal_and_plan"]
    return checks


def usage_summary(records):
    calls = [r for r in records if r.get("status") == 200]
    tokens = {"prompt": 0, "output": 0, "total": 0}
    measured = 0
    for r in calls:
        usage = r.get("usage") or {}
        if usage:
            measured += 1
            tokens["prompt"] += usage.get("promptTokenCount", 0)
            tokens["output"] += usage.get("candidatesTokenCount", 0)
            tokens["total"] += usage.get("totalTokenCount", usage.get("promptTokenCount", 0) + usage.get("candidatesTokenCount", 0))
    failures = {}
    for r in records:
        if r.get("status") != 200:
            failures[r.get("code") or f"http_{r.get('status')}"] = failures.get(r.get("code") or f"http_{r.get('status')}", 0) + 1
    routes = {}
    for r in calls:
        routes[r.get("route")] = routes.get(r.get("route"), 0) + 1
    return {"requests": len(records), "answered": len(calls), "answers_with_usage": measured, "tokens": tokens,
            "prompt_chars": sum(r.get("promptChars", 0) for r in records),
            "estimated_prompt_tokens_from_chars": round(sum(r.get("promptChars", 0) for r in records) / 3.5),
            "routes": routes, "failures": failures}


def judge(files, hidden, docker):
    """Run the AI's own tests and then only the hidden acceptance tests, each in a sandbox container."""
    if not docker:
        return {"skipped": "Docker is not available here; the workflow runs this on GitHub's runner"}
    own_py = any(p.startswith("tests/") and p.endswith(".py") and "/test_" in p for p in files)
    own_js = [p for p in files if p.endswith(".test.mjs")]
    result = {}

    def run(name, image, args, extra=None):
        try:
            done = multi_agent_check.run_in_sandbox({**files, **(extra or {})}, image, args, timeout=180)
            result[name] = {"passed": done.returncode == 0, "output": (done.stdout + done.stderr)[-2500:]}
        except Exception as exc:  # A sandbox failure is a result, not a reason to stop the other scenarios.
            result[name] = {"passed": False, "output": f"sandbox error: {type(exc).__name__}: {str(exc)[:300]}"}

    if own_py:
        run("own_python", "python:3.13-slim", ["python", "-B", "-m", "unittest", "discover", "-s", "tests", "-t", ".", "-v"])
    if own_js:
        run("own_javascript", "node:22-slim", ["node", "--test", "--", *own_js])
    py_hidden = {p: t for p, t in hidden.items() if p.endswith(".py")}
    js_hidden = {p: t for p, t in hidden.items() if p.endswith(".mjs")}
    if py_hidden:
        run("acceptance_python", "python:3.13-slim",
            ["python", "-B", "-m", "unittest", "discover", "-s", "tests", "-t", ".", "-p", "test_zz_acceptance*.py", "-v"], py_hidden)
    if js_hidden:
        run("acceptance_javascript", "node:22-slim", ["node", "--test", "--", *js_hidden], js_hidden)
    return result


MAX_CONTINUATIONS = 3


def continuation_wait(exc):
    """Seconds to wait before resuming, or None when production would stop rather than defer (see runner.main)."""
    from engine import recovery
    kind, _ = recovery.diagnose(exc)
    recoverable = isinstance(exc, (developer.GenerationFailure, runner.TaskTimeExpired, RuntimeError, TimeoutError, urllib.error.URLError))
    if not recoverable or kind in ("authorization", "access") or getattr(exc, "terminal", False) or isinstance(exc, RealGitHubBlocked):
        return None
    retry_at = getattr(exc, "retry_at", 0) or 0
    return int(min(240, max(60, retry_at - time.time())))


def continue_task(sim, issue, continuations, journal):
    """The engine call production's runner.main makes for this run: start, continue a plan-only draft, or repair.

    The decision mirrors runner.main's resume branch and uses the recovery journal saved by the earlier run."""
    if not continuations:
        return developer.produce_development_pr(issue, "", "simulated-token")
    branch = f"kappa/dev-{issue['number']}"
    pulls = sim.gh(f"repos/{sim.repo}/pulls?state=open&head={OWNER}:{branch}", "simulated-token")
    if len(pulls) > 1:
        raise PermissionError("Ambiguous candidate PR; owner review required")
    adopt = pulls[0] if pulls and not journal.state["files"] and journal.state["pr"] == pulls[0].get("html_url") else None
    if not pulls and journal.state["pr"]:
        raise PermissionError("Saved PR is closed; automatic continuation will not reopen it")
    if pulls and adopt is None:
        return developer.fix_pull_request(issue, "", "simulated-token")
    return developer.produce_development_pr(issue, "", "simulated-token", **({"adopt": adopt} if adopt else {}))


def journal_for(sim, issue):
    """The production recovery journal, persisted in the task issue's comments on the simulated GitHub."""
    from engine import recovery
    return recovery.Journal(issue, lambda path: sim.gh(path, "simulated-token"),
                            lambda path, payload, method: sim.gh(path, "simulated-token", payload, method or "POST"))


def run_scenario(scenario, records, docker, minutes):
    repo = f"{OWNER}/kappaforge-sim-{scenario['key']}"
    issue = {"number": scenario["number"], "title": scenario["title"], "state": "open", "user": {"login": OWNER},
             "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
             "body": f"Repository: {repo}\nMode: develop\n\n{scenario['task']}"}
    sim = SimGitHub(repo, scenario["number"], scenario["title"], scenario["files"], issue)
    real_registered = projects.registered

    def registered(name):
        if name == repo:
            return {"enabled": True, "branches": r"kappa/dev-[0-9]+", "maxWaitSeconds": 21600,
                    "budgets": {"edits": 120, "modelCalls": 160, "fixCycles": 12}}
        return real_registered(name)

    start = len(records)
    developer.Progress.latest = None
    began = time.time()
    outcome = {"key": scenario["key"], "title": scenario["title"], "repository": repo}
    patches = [(developer, "gh", sim.gh), (repo_maps, "download_sources", sim.download), (projects, "registered", registered),
               (urllib.request, "urlopen", guarded_urlopen), (runner, "request", lambda *a, **k: (_ for _ in ()).throw(
                   RealGitHubBlocked("Simulation refused runner.request"))),
               (runner, "github", lambda path, token=None, payload=None: sim.gh(path, token, payload))]
    saved = [(module, name, getattr(module, name)) for module, name, _ in patches]
    # The engine reads GITHUB_TOKEN for its task checks; every GitHub call here goes to the simulation, never GitHub.
    real_token = os.environ.get("GITHUB_TOKEN")
    os.environ["GITHUB_TOKEN"] = "simulated-token"
    try:
        for module, name, value in patches:
            setattr(module, name, value)
        outcome["continuations"] = []
        while True:
            # Each continuation is a fresh run, as in production: new caches, scope and time budget.
            for cache in (runner._lists, runner.EXHAUSTED, runner.COOLDOWN):
                cache.clear()
            developer.UNFINISHED.clear()
            runner.TASK_DEADLINE = time.monotonic() + minutes * 60
            intent_guard.activate(issue)
            from engine import recovery
            journal = journal_for(sim, issue)
            handle = recovery.CURRENT.set(journal)
            try:
                url = continue_task(sim, issue, outcome["continuations"], journal)
                outcome["result"] = "draft_pr" if url else "stopped_before_push"
                outcome["pr_url"] = url
                break
            except Exception as exc:
                outcome["error"] = f"{type(exc).__name__}: {str(exc)[:600]}"
                outcome["traceback_tail"] = traceback.format_exc()[-1500:]
                wait = continuation_wait(exc)
                if wait is None or len(outcome["continuations"]) >= MAX_CONTINUATIONS:
                    outcome["result"] = "task_failed"
                    break
                outcome["continuations"].append({"after": outcome.pop("error"), "waited_seconds": wait})
                outcome.pop("traceback_tail")
                print(f"Recoverable failure; production would defer and resume. Resuming in {wait}s.", flush=True)
                time.sleep(wait)
            finally:
                recovery.CURRENT.reset(handle)
    finally:
        for module, name, value in saved:
            setattr(module, name, value)
        intent_guard.ACTIVE.set(None)
        runner.TASK_DEADLINE = None
        if real_token is None:
            os.environ.pop("GITHUB_TOKEN", None)
        else:
            os.environ["GITHUB_TOKEN"] = real_token
    outcome["seconds"] = round(time.time() - began, 1)
    branch = f"kappa/dev-{scenario['number']}"
    head = sim.refs.get(branch)
    final = sim.files_at(head) if head else {}
    outcome["changed_files"] = sim.changed(head) if head else []
    outcome["lines_changed"] = sum(abs(len(final.get(p, "").splitlines()) - len(scenario["files"].get(p, "").splitlines()))
                                   for p in outcome["changed_files"])
    pr = next(iter(sim.prs.values()), None)
    outcome["open_problems"] = developer.requirements_open(pr) if pr else None
    outcome["final_title"] = pr["title"] if pr else None
    outcome["final_body"] = pr["body"][:6000] if pr else None
    outcome["plan_body"] = sim.opened_body[:4000] if sim.opened_body else None
    outcome["lifecycle"] = lifecycle_checks(sim, outcome.get("pr_url"))
    outcome["checks_requested"] = sim.dispatches
    outcome["timeline"] = [{k: v for k, v in e.items() if k != "t"} for e in sim.events]
    outcome["progress_comment"] = (list(sim.comments.values())[0][:4000] if sim.comments else None)
    outcome["final_comment"] = (list(sim.comments.values())[-1][:3000] if len(sim.comments) > 1 else None)
    outcome["usage"] = usage_summary(records[start:])
    outcome["tests"] = judge(final, scenario["hidden"], docker) if head and outcome["changed_files"] else {"skipped": "no code on the draft"}
    return outcome


def markdown(report):
    lines = ["# KappaForge lifecycle simulation", "",
             f"Real engine and real gateway inference; simulated GitHub; generated code judged in sandbox containers. "
             f"{report['finished_at']}.", "",
             "| Scenario | Result | Seconds | Model answers | Tokens (prompt / output / total) | Own tests | Hidden acceptance | Lifecycle rules |",
             "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for s in report["scenarios"]:
        u, t = s["usage"], s["tests"]
        mark = lambda names: " / ".join(("pass" if t[n]["passed"] else "FAIL") for n in names if n in t) or ("skipped" if "skipped" in t else "-")
        rules = s["lifecycle"]
        lines.append(f"| {s['key']} | {s['result']} | {s['seconds']} | {u['answered']}/{u['requests']} | "
                     f"{u['tokens']['prompt']:,} / {u['tokens']['output']:,} / {u['tokens']['total']:,} | "
                     f"{mark(['own_python', 'own_javascript'])} | {mark(['acceptance_python', 'acceptance_javascript'])} | "
                     f"{sum(rules.values())}/{len(rules)} |")
    totals = report["totals"]
    lines += ["", f"**Total:** {totals['answered']} model answers from {totals['requests']} requests; "
              f"{totals['tokens']['total']:,} tokens measured by the gateway ({totals['tokens']['prompt']:,} prompt, "
              f"{totals['tokens']['output']:,} output); about {totals['estimated_prompt_tokens_from_chars']:,} prompt tokens "
              f"by character count.", ""]
    for s in report["scenarios"]:
        lines += [f"## {s['key']}: {s['title']}", "", f"- Result: **{s['result']}**" + (f" ({s.get('error')})" if s.get("error") else ""),
                  f"- Changed files: {', '.join(s['changed_files']) or 'none'}",
                  f"- Continuations after recoverable failures: {len(s.get('continuations', []))}"
                  + "".join(f"\n  - waited {c['waited_seconds']}s after {c['after'][:200]}" for c in s.get("continuations", [])),
                  f"- Open problems on the draft: {s['open_problems']}",
                  f"- Routes: {s['usage']['routes']}; failures: {s['usage']['failures'] or 'none'}",
                  "- Lifecycle: " + ", ".join(f"{k} {'✅' if v else '❌'}" for k, v in s["lifecycle"].items()),
                  "- Timeline: " + " → ".join(e["kind"] + (f"({','.join(e['files'])})" if e.get("files") else "") for e in s["timeline"]
                                             if e["kind"] in ("commit", "branch_created", "pr_opened", "pr_updated", "branch_updated", "checks_requested", "violation")), ""]
        for name, run in s["tests"].items() if isinstance(s["tests"], dict) else []:
            if isinstance(run, dict):
                lines += [f"<details><summary>{name}: {'pass' if run['passed'] else 'FAIL'}</summary>", "", "```", run["output"][-1500:], "```", "</details>", ""]
    return "\n".join(lines)


def docker_available():
    import shutil
    import subprocess
    try:
        return bool(shutil.which("docker")) and subprocess.run(["docker", "info"], capture_output=True, timeout=30).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--only", default="easy,medium,complex")
    parser.add_argument("--out", default="lifecycle-simulation.json")
    parser.add_argument("--minutes", type=int, default=40, help="engine time budget per scenario")
    parser.add_argument("--pause", type=int, default=60, help="seconds between scenarios, as between separate real tasks")
    args = parser.parse_args(argv)
    if os.getenv("KAPPA_ROUTER_REQUIRED", "").lower() != "true":
        raise SystemExit("Set KAPPA_ROUTER_REQUIRED=true with KAPPA_ROUTER_URL and KAPPA_ROUTER_TOKEN: the simulation uses the real gateway")
    wanted = args.only.split(",")
    records = []
    real_record = gateway.record

    def record(journal, evidence):
        records.append(dict(evidence))
        real_record(journal, evidence)

    gateway.record = record
    docker = docker_available()
    report = {"started_at": time.strftime("%Y-%m-%d %H:%M:%SZ", time.gmtime()), "docker": docker, "scenarios": []}
    try:
        for n, scenario in enumerate(s for s in SCENARIOS if s["key"] in wanted):
            if n:
                time.sleep(args.pause)
            print(f"\n=== Scenario {scenario['key']}: {scenario['title']} ===", flush=True)
            outcome = run_scenario(scenario, records, docker, args.minutes)
            report["scenarios"].append(outcome)
            print(f"=== {scenario['key']}: {outcome['result']} in {outcome['seconds']}s; tokens {outcome['usage']['tokens']}", flush=True)
    finally:
        gateway.record = real_record
    report["finished_at"] = time.strftime("%Y-%m-%d %H:%M:%SZ", time.gmtime())
    report["totals"] = usage_summary(records)
    with open(args.out, "w") as handle:
        json.dump(report, handle, indent=1)
    summary = markdown(report)
    print("\n" + summary)
    if os.getenv("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as handle:
            handle.write(summary + "\n")
    broken = [f"{s['key']}: {rule}" for s in report["scenarios"] for rule, ok in s["lifecycle"].items()
              if not ok and (s["result"] != "task_failed" or rule in ("stays_draft", "never_merged", "main_never_moved", "no_real_github_calls"))]
    # A scenario that failed before a single gateway request tested nothing: never report that run as a success.
    broken += [f"{s['key']}: failed before any model request ({s.get('error', '')[:160]})" for s in report["scenarios"]
               if s["result"] == "task_failed" and not s["usage"]["requests"]]
    delivered = sum(1 for s in report["scenarios"] if all(r.get("passed") for n, r in s["tests"].items() if n.startswith("acceptance")
                                                           and isinstance(r, dict)) and any(n.startswith("acceptance") for n in s["tests"]))
    print(f"\nSIMULATION VERDICT: {delivered}/{len(report['scenarios'])} scenarios passed every hidden acceptance test; "
          f"{report['totals']['tokens']['total']:,} gateway-measured tokens; lifecycle rule breaches: {broken or 'none'}")
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main())
