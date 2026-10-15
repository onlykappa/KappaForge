"""Resumable, owner-approved coding milestones in isolated KappaForge sandbox."""
import re
import urllib.error
import base64
from engine.coder import generate, gh
from engine.runner import ROOT

STEP_RE = re.compile(r"^Step ([1-5]):\s*(.{15,650})\s*$", re.I | re.M)

def steps_from_issue(issue):
    body = issue.get("body") or ""
    if not re.search(r"^Repository:\s*onlykappa/KappaForge\s*$", body, re.I | re.M):
        raise ValueError("Only KappaForge sandbox milestones supported")
    if not re.search(r"^Mode:\s*continuous-code\s*$", body, re.I | re.M):
        raise ValueError("Explicit continuous-code approval required")
    found = STEP_RE.findall(body)
    if not found or len(found) > 5:
        raise ValueError("Specify 1-5 independent Step N: lines, each at least 15 characters")
    nums = [int(n) for n, _ in found]
    if nums != list(range(1, len(nums) + 1)):
        raise ValueError("Number steps consecutively starting at 1")
    return [task.strip() for _, task in found]

def code_one_step(issue, key, token):
    if (issue.get("user") or {}).get("login", "").lower() != "onlykappa":
        raise ValueError("Owner-authored issue required")
    number = int(issue["number"])
    tasks = steps_from_issue(issue)
    for n, task in enumerate(tasks, 1):
        branch = f"kappa/cont-{number}-{n}"
        try:
            gh(f"repos/{ROOT}/git/ref/heads/{branch}", token)
        except urllib.error.HTTPError as err:
            if err.code != 404:
                raise
        else:
            prs = gh(f"repos/{ROOT}/pulls?state=all&head=onlykappa:{branch}", token)
            if not prs:
                raise RuntimeError("Existing branch without PR requires manual recovery: " + branch)
            continue
        model, files = generate(key, f"Independent sandbox milestone {n}: {task}")
        main = gh(f"repos/{ROOT}/git/ref/heads/main", token)
        gh(f"repos/{ROOT}/git/refs", token, {"ref": "refs/heads/" + branch,
                                               "sha": main["object"]["sha"]})
        for path, body in files:
            payload = {"message": f"feat: issue #{number} milestone {n} ({path})",
                       "branch": branch, "content": base64.b64encode(body.encode()).decode()}
            try:
                prior = gh(f"repos/{ROOT}/contents/{path}?ref={branch}", token)
                payload["sha"] = prior["sha"]
            except urllib.error.HTTPError as err:
                if err.code != 404:
                    raise
            gh(f"repos/{ROOT}/contents/{path}", token, payload, method="PUT")
        pr = gh(f"repos/{ROOT}/pulls", token, {
            "title": f"Draft milestone {n}/{len(tasks)} for KappaForge issue #{number}",
            "head": branch, "base": "main", "draft": True,
            "body": f"Owner-approved independent sandbox milestone {n}/{len(tasks)}.\n\nTask: {task}\nModel: {model}\n\nAI-generated files, independent validation and manual review required. No auto-merge or deployment."})
        note = f"### Continuous coding milestone {n}/{len(tasks)}\nDraft PR: {pr['html_url']}\n"
        try:
            gh(f"repos/{ROOT}/actions/workflows/sandbox-tests.yml/dispatches", token,
               {"ref": "main", "inputs": {"branch": branch}})
            note += "Independent validation dispatched. Check GitHub Actions."
        except urllib.error.HTTPError as err:
            note += f"Validation dispatch HTTP {err.code}. Run validation manually."
        gh(f"repos/{ROOT}/issues/{number}/comments", token, {"body": note})
        return {"status": "draft", "step": n, "url": pr["html_url"]}
    return {"status": "all_drafts_created", "steps": len(tasks)}
