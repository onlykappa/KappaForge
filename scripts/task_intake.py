"""Dispatch a new owner-authored development task once, without handling issue text as commands."""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime


ROOT = "onlykappa/KappaForge"
API = "https://api.github.com"


def request(path, token, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(API + path, data=data, headers={
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "KappaForge-Task-Intake",
    }, method="POST" if payload is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"GitHub API returned HTTP {exc.code}") from exc


def eligible(issue, action, label_name=""):
    if (not isinstance(issue, dict) or issue.get("pull_request") or issue.get("state") != "open"
            or (issue.get("user") or {}).get("login", "").lower() != "onlykappa"):
        return False
    labels = {str(row.get("name", "")).lower() for row in issue.get("labels", []) if isinstance(row, dict)}
    if "kappa-task" not in labels and not (action == "labeled" and label_name.lower() == "kappa-task"):
        return False
    body = issue.get("body") or ""
    if "Approved from KappaForge Chat." in body:
        return False  # The chat backend already dispatches these tasks with their provenance.
    if (len(re.findall(r"^Repository:\s*onlykappa/KappaForge\s*$", body, re.M | re.I)) != 1
            or len(re.findall(r"^Mode:\s*develop\s*$", body, re.M | re.I)) != 1):
        return False
    try:
        from engine.intent_guard import ExecutionScope
        ExecutionScope(issue)
    except (PermissionError, ValueError, TypeError):
        return False
    return True


def already_dispatched(issue_number, created_at, token):
    earliest = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    for page in range(1, 11):
        query = urllib.parse.urlencode({"event": "workflow_dispatch", "per_page": 100, "page": page})
        runs = request(f"/repos/{ROOT}/actions/workflows/agent.yml/runs?{query}", token).get("workflow_runs", [])
        for run in runs:
            if (str(run.get("display_title", "")).startswith(f"Agent task #{issue_number} ")
                    and datetime.fromisoformat(run["created_at"].replace("Z", "+00:00")) >= earliest):
                return True
        if len(runs) < 100:
            return False
    raise RuntimeError("Task workflow history exceeded the supported inspection limit")


def dispatch(issue, token):
    if already_dispatched(issue["number"], issue["created_at"], token):
        return "already-dispatched"
    request(f"/repos/{ROOT}/actions/workflows/agent.yml/dispatches", token,
            {"ref": "main", "inputs": {"issue_number": str(int(issue["number"]))}})
    return "dispatched"


def main():
    event = json.loads(open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8").read())
    action = os.environ.get("GITHUB_EVENT_ACTION", "")
    issue = event.get("issue") or {}
    label_name = (event.get("label") or {}).get("name", "")
    if not eligible(issue, action, label_name):
        print("Task intake skipped: issue is outside the owner-authorized development intake scope")
        return
    result = dispatch(issue, os.environ["GITHUB_TOKEN"])
    print(f"Task #{int(issue['number'])}: {result}")


if __name__ == "__main__":
    main()
