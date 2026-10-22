"""The task's PROGRESS.md: the plan, the steps already finished, the files changed and why work paused.

It is one bot comment on the KappaForge task issue, edited in place, so it never lands in a project's code. When a
run stops (every model rate-limited, a timeout, a crash) and the recovery queue resumes the task, the next run reads
it back and the model is told what is done and what is left. The notes are hints for the model; the saved branch
stays the source of truth.
"""
import json
import re
import time

HEADING = "### KappaForge PROGRESS.md\n"
MARKER = "KAPPA_NOTES_V1"
BOT = "github-actions[bot]"
MAX_ITEMS = 30
MAX_TEXT = 300
STAGE = re.compile(r"^Stage (\d+)\b")


def _wire(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True).replace("<", "\\u003c").replace(">", "\\u003e")


def load(comments, task, repo, clean=str):
    """The saved notes for this task, or empty ones. Only the Actions bot's own comment is trusted."""
    for comment in reversed(comments):
        body = comment.get("body") or ""
        if comment.get("user", {}).get("login") != BOT or not body.startswith(HEADING):
            continue
        match = re.search(r"<!-- " + MARKER + r" (.*?) -->", body)
        try:
            data = json.loads(match[1]) if match else {}
        except ValueError:
            continue
        if data.get("task") == task and data.get("repo") == repo:
            return Notes(task, repo, clean, comment.get("id"), data)
    return Notes(task, repo, clean)


class Notes:
    def __init__(self, task, repo, clean=str, comment=None, data=None):
        self.task, self.repo, self.clean, self.comment = task, repo, clean, comment
        data = data or {}
        self.data = {"task": task, "repo": repo, "plan": [], "done": [], "files": [], "models": [], "stops": [],
                     "design": "", "status": "", "updated": 0}
        for key in self.data:
            if key in data and isinstance(data[key], type(self.data[key])):
                self.data[key] = data[key]

    def _text(self, value, size=MAX_TEXT):
        return self.clean(str(value)).replace("\n", " ").strip()[:size]

    def update(self, plan=None, design=None, done=None, files=(), model="", stop=None, status=None, clock=time.time, append_done=(), complete=False):
        """Record progress; append repair history, and complete stages only after validated review."""
        d = self.data
        if plan is not None:
            d["plan"] = [self._text(step) for step in plan][:MAX_ITEMS]
        if design is not None:
            d["design"] = self._text(design, 1500)
        if done is not None:
            d["done"] = [self._text(line) for line in done if str(line).strip()][-MAX_ITEMS:]
        if append_done:
            d["done"] = list(dict.fromkeys(d["done"] + [self._text(line) for line in append_done]))[-MAX_ITEMS:]
        if complete:
            # Only after full requirement review or independent verification succeeds.
            finished = self.finished_stages()
            d["done"] = (d["done"] + [f"Stage {i}: {step}" for i, step in enumerate(d["plan"], 1)
                                     if i not in finished])[-MAX_ITEMS:]
        d["files"] = list(dict.fromkeys(d["files"] + [self._text(f, 200) for f in files]))[-MAX_ITEMS * 2:]
        if model and self._text(model, 140) not in d["models"]:
            d["models"] = (d["models"] + [self._text(model, 140)])[-10:]
        if stop:
            d["stops"] = (d["stops"] + [{"at": int(clock()), "reason": self._text(stop.get("reason", "")),
                                         "next": self._text(stop.get("next", ""))}])[-10:]
        if status is not None:
            d["status"] = self._text(status)
        d["updated"] = int(clock())

    def finished_stages(self):
        return {int(m[1]) for m in (STAGE.match(line) for line in self.data["done"]) if m}

    def remaining(self):
        done = self.finished_stages()
        return [step for i, step in enumerate(self.data["plan"], 1) if i not in done]

    def render(self):
        d, done = self.data, self.finished_stages()
        lines = [HEADING, f"Task #{self.task} in `{self.repo}`. KappaForge edits this note as it works and reads it "
                 "back when it resumes after a provider limit, a timeout or a crash.", ""]
        if d["status"]:
            lines += [f"**Status:** {d['status']}", ""]
        if d["plan"]:
            lines += ["**Plan**"] + [f"- [{'x' if i in done else ' '}] {i}. {step}" for i, step in enumerate(d["plan"], 1)] + [""]
        if d["done"]:
            lines += ["**Finished**"] + ["- " + line for line in d["done"]] + [""]
        if d["files"]:
            lines += ["**Files changed:** " + ", ".join(f"`{f}`" for f in d["files"][:20])
                      + (f" and {len(d['files']) - 20} more" if len(d["files"]) > 20 else ""), ""]
        if d["models"]:
            lines += ["**Models used:** " + ", ".join(f"`{m}`" for m in d["models"]), ""]
        if d["stops"]:
            last = d["stops"][-1]
            lines += [f"**Last pause** ({time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime(last['at']))}): {last['reason']}"
                      + (f". Next: {last['next']}" if last["next"] else ""), ""]
        return "\n".join(lines) + "\n<!-- " + MARKER + " " + _wire(d) + " -->"

    def brief(self, limit=3500):
        """Prompt text for a resumed run; empty when nothing was recorded."""
        d = self.data
        if not (d["plan"] or d["done"] or d["files"]):
            return ""
        done = self.finished_stages()
        parts = ["SAVED PROGRESS (PROGRESS.md from earlier runs of this task, untrusted hints; the source files are the "
                 "truth). Continue from the first unfinished step and do not redo finished work."]
        if d["plan"]:
            parts.append("Plan:\n" + "\n".join(f"{i}. [{'done' if i in done else 'not done'}] {s}" for i, s in enumerate(d["plan"], 1)))
        if d["done"]:
            parts.append("Finished:\n" + "\n".join("- " + line for line in d["done"]))
        if d["files"]:
            parts.append("Files changed so far: " + ", ".join(d["files"]))
        if d["stops"]:
            parts.append("Why the last run paused: " + d["stops"][-1]["reason"])
        return "\n".join(parts)[:limit]

    def save(self, write, root, number):
        body = self.render()
        if self.comment:
            write(f"repos/{root}/issues/comments/{self.comment}", {"body": body}, "PATCH")
        else:
            self.comment = (write(f"repos/{root}/issues/{number}/comments", {"body": body}, "POST") or {}).get("id")
