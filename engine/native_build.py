"""Native iOS builds of agent development branches: start them, find them, and summarise their history.

The agent cannot run Xcode itself. It dispatches KappaForge's trusted ios-build workflow from main for its own
branch and reads the result like any other independent check. Runs are named "iOS build <branch> @ <sha>".
"""
from engine.coder import gh
from engine.runner import ROOT

WORKFLOW = "ios-build.yml"
# Anything bundled into, or used to build, the iPhone app.
NATIVE_PATHS = ("ios/", "preview/", "scripts/", "config/", ".github/workflows/ios-build.yml")


def needed(repo, paths):
    return repo == ROOT and any(p.startswith(NATIVE_PATHS) for p in paths)


def title(branch, sha):
    return f"iOS build {branch} @ {sha}"


def dispatch(branch, sha, token):
    gh(f"repos/{ROOT}/actions/workflows/{WORKFLOW}/dispatches", token,
       {"ref": "main", "inputs": {"branch": branch, "candidate_sha": sha}})


def _runs(token):
    runs = gh(f"repos/{ROOT}/actions/workflows/{WORKFLOW}/runs?per_page=50", token).get("workflow_runs", [])
    # Only builds dispatched from main's trusted workflow count; a branch cannot vouch for itself.
    return [r for r in runs if r.get("event") == "workflow_dispatch" and r.get("head_branch") == "main"]


def result(branch, sha, token):
    """Latest native build of this exact commit, or None."""
    return next((r for r in _runs(token) if r.get("display_title") == title(branch, sha)), None)


def history(branch, token, limit=5):
    """Previous and current native builds of a branch, newest first, with the steps that failed."""
    prefix = f"iOS build {branch} @ "
    builds = []
    for run in [r for r in _runs(token) if (r.get("display_title") or "").startswith(prefix)][:limit]:
        failed = []
        if run.get("conclusion") == "failure":
            jobs = gh(f"repos/{ROOT}/actions/runs/{int(run['id'])}/jobs?per_page=30", token).get("jobs", [])
            failed = [s.get("name", "") for j in jobs for s in j.get("steps", []) if s.get("conclusion") == "failure"]
        builds.append({"sha": run["display_title"][len(prefix):], "status": run.get("status"), "conclusion": run.get("conclusion"),
                       "url": run.get("html_url"), "at": run.get("created_at"), "failed_steps": failed})
    return builds


def summary(builds):
    """One line per build, for the fix prompt and the task report."""
    def state(b):
        if b["status"] != "completed":
            return "running"
        if b["conclusion"] == "failure":
            return "failed" + (" at " + ", ".join(b["failed_steps"][:3]) if b["failed_steps"] else "")
        return b["conclusion"] or "unknown"
    return "\n".join(f"- {b['sha'][:7]} ({b['at'] or 'unknown time'}): {state(b)}" for b in builds)
