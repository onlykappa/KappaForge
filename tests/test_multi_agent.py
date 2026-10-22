"""Independent stages are built at the same time by separate workers; overlapping or dependent stages stay in order."""
import json
import threading
import time
import unittest
from unittest.mock import patch

from engine import developer, recovery
from engine.developer import Stage, waves


class WaveTests(unittest.TestCase):
    def test_only_independent_stages_with_separate_files_share_a_wave(self):
        stages = [Stage("api", ["api.py"], True), Stage("ui", ["ui.js"], True), Stage("api again", ["api.py"], True),
                  Stage("unknown files", [], True), Stage("ordered", ["x.py"], False)]
        self.assertEqual(waves(stages), [[0, 1], [2], [3], [4]])
        self.assertEqual(waves(["plain", "strings"]), [[0], [1]], "stages without file lists run one at a time")
        many = [Stage(str(n), [f"{n}.py"], True) for n in range(5)]
        self.assertEqual(waves(many), [[0, 1, 2], [3, 4]], "at most three workers at once")

    def test_the_planner_says_which_files_each_stage_edits(self):
        plan = {"read": ["api.py", "ui.js"], "stages": ["Add the endpoint", "Add the screen"],
                "stage_files": [["api.py", "tests/test_api.py"], ["ui.js", "ios/KappaForge/Web/ui.js"]], "independent": True, "design": "d"}
        with patch.object(developer, "run_model", return_value=("m", json.dumps(plan))):
            paths, stages, design = developer.select_files("k", "task", {"api.py": 10, "ui.js": 10}, with_stages=True)
        self.assertEqual([s.files for s in stages], [("api.py", "tests/test_api.py"), ("ui.js",)], "iOS web copies are never a stage's file")
        self.assertTrue(all(s.independent for s in stages))
        self.assertEqual(waves(stages), [[0, 1]])


class ParallelBuildTests(unittest.TestCase):
    def build(self, stages, fake, checkpoint=None, review=(True, "")):
        with patch.object(developer, "generate", side_effect=fake), \
                patch.object(developer, "review_stage", side_effect=review if callable(review) else lambda *a: review):
            return developer.build_in_stages("k", "Build a feature", "o/r", {"api.py": "old\n", "ui.js": "old\n"},
                                             {"api.py": 4, "ui.js": 4}, "", None, stages, checkpoint=checkpoint)

    def test_independent_stages_run_at_the_same_time_and_save_once(self):
        running, peak, prompts, seen_journal, lock = [0], [0], {}, [], threading.Lock()
        journal = object()

        def fake(api_key, step, repo, current, files, guide, allowed, design, allow_empty=False):
            with lock:
                running[0] += 1
                peak[0] = max(peak[0], running[0])
            seen_journal.append(recovery.CURRENT.get())
            time.sleep(0.3)
            with lock:
                running[0] -= 1
            path = "api.py" if "endpoint" in step.split("Do only this stage now:")[1].split("\n")[0] else "ui.js"
            prompts[path] = step
            return "model-" + path, "did " + path, {path: "new " + path + "\n"}, "why"

        saves = []
        token = recovery.CURRENT.set(journal)
        try:
            started = time.time()
            model, summary, changes, explanation = self.build(
                [Stage("Add the endpoint", ["api.py"], True), Stage("Add the screen", ["ui.js"], True)], fake,
                checkpoint=lambda *a: saves.append(dict(a[2])))
            elapsed = time.time() - started
        finally:
            recovery.CURRENT.reset(token)
        self.assertEqual(peak[0], 2, "both workers ran at once")
        self.assertLess(elapsed, 0.55, "two 0.3s stages took about 0.3s, not 0.6s")
        self.assertEqual(changes, {"api.py": "new api.py\n", "ui.js": "new ui.js\n"})
        self.assertEqual(seen_journal, [journal, journal], "workers keep the task's recovery journal")
        self.assertIn("Other developers are building these stages at the same time", prompts["api.py"])
        self.assertIn("Edit or create only these files: api.py", prompts["api.py"])
        self.assertEqual(len(saves), 1, "one checkpoint for the wave")
        self.assertIn("Stage 1 (written by model-api.py)", summary)
        self.assertIn("Stage 2 (written by model-ui.js)", summary)

    def test_workers_that_touch_the_same_file_are_redone_in_order(self):
        calls = []

        def fake(api_key, step, repo, current, files, guide, allowed, design, allow_empty=False):
            together = "Other developers" in step
            calls.append(together)
            return "m", "s", {"api.py": current["api.py"] + ("parallel\n" if together else "after\n")}, "e"

        model, summary, changes, explanation = self.build(
            [Stage("One", ["api.py"], True), Stage("Two", ["ui.js"], True)], fake)
        self.assertEqual(calls, [True, True, False], "the overlapping stage was rebuilt on its own")
        self.assertEqual(changes["api.py"], "old\nparallel\nafter\n", "the redo builds on the first worker's change")

    def test_a_failed_worker_keeps_the_other_workers_change(self):
        def fake(api_key, step, repo, current, files, guide, allowed, design, allow_empty=False):
            if "Add the screen" in step.split("Do only this stage now:")[1].split("\n")[0]:
                raise ValueError("provider limit")
            return "m", "s", {"api.py": "new\n"}, "e"

        developer.UNFINISHED.clear()
        model, summary, changes, explanation = self.build(
            [Stage("Add the endpoint", ["api.py"], True), Stage("Add the screen", ["ui.js"], True)], fake)
        self.assertEqual(changes, {"api.py": "new\n"})
        self.assertTrue(any("Step 2 of 2 was not done" in u for u in developer.UNFINISHED))

    def test_each_worker_sees_its_own_files_and_little_else(self):
        seen = {}

        def fake(api_key, step, repo, current, files, guide, allowed, design, allow_empty=False):
            own = "api.py" if "endpoint" in step.split("Do only this stage now:")[1].split("\n")[0] else "ui.js"
            seen[own] = set(current)
            return "m", "s", {own: "new\n"}, "e"

        with patch.object(developer, "WORKER_SHARED_CHARS", 5):
            self.build([Stage("Add the endpoint", ["api.py"], True), Stage("Add the screen", ["ui.js"], True)], fake)
        self.assertEqual(seen, {"api.py": {"api.py", "ui.js"}, "ui.js": {"ui.js", "api.py"}}, "a small shared file still fits")
        big = {"api.py": "x" * 10, "ui.js": "y" * 10, "huge.py": "z" * 100000, "notes.md": "mentioned"}
        picked = developer.worker_sources(Stage("Update notes.md for the endpoint", ["api.py"], True), big)
        self.assertEqual(list(picked)[:2], ["api.py", "notes.md"], "own files, then files the stage names")
        self.assertNotIn("huge.py", picked, "the rest only within the shared budget")

    def test_the_reviewer_sends_a_problem_back_once(self):
        prompts = []

        def fake(api_key, step, repo, current, files, guide, allowed, design, allow_empty=False):
            prompts.append(step)
            own = "api.py" if "endpoint" in step.split("Do only this stage now:")[1].split("\n")[0] else "ui.js"
            fixed = "A reviewer checked your first attempt" in step
            return "m", "s", {own: ("fixed" if fixed else "first") + "\n"}, "e"

        reviews = []

        def review(api_key, task, stage, changes, before, allowed=None):
            reviews.append(str(stage))
            return (False, "the endpoint does not validate input") if "endpoint" in stage and len(reviews) <= 2 else (True, "")

        model, summary, changes, explanation = self.build(
            [Stage("Add the endpoint", ["api.py"], True), Stage("Add the screen", ["ui.js"], True)], fake, review=review)
        self.assertEqual(changes, {"api.py": "fixed\n", "ui.js": "first\n"})
        redo = [p for p in prompts if "A reviewer checked your first attempt" in p]
        self.assertEqual(len(redo), 1)
        self.assertIn("the endpoint does not validate input", redo[0])

    def test_a_review_that_cannot_run_never_blocks(self):
        with patch.object(developer, "run_model", side_effect=RuntimeError("no provider")):
            self.assertEqual(developer.review_stage("k", "t", Stage("s", ["a.py"], True), {"a.py": "x\n"}, {}), (True, ""))
        with patch.object(developer, "run_model", return_value=("m", '{"ok":false,"problem":"misses the test"}')) as model:
            self.assertEqual(developer.review_stage("k", "t", Stage("s", ["a.py"], True), {"a.py": "x\n", "b.py": "y\n"}, {}),
                             (False, "misses the test"))
        self.assertIn("IT ALSO EDITED: b.py", model.call_args.args[1])

    def test_dependent_stages_still_run_in_order(self):
        order = []

        def fake(api_key, step, repo, current, files, guide, allowed, design, allow_empty=False):
            self.assertNotIn("Other developers", step)
            order.append(step.split("Do only this stage now: ")[1].split("\n")[0])
            return "m", "s", {"api.py": current["api.py"] + order[-1] + "\n"}, "e"

        self.build([Stage("first", ["api.py"], False), Stage("second", ["api.py"], False)], fake)
        self.assertEqual(order, ["first", "second"])


if __name__ == "__main__":
    unittest.main()
