"""Owner-approved self-repair proposals for selected KappaForge source files.

The privileged agent never executes generated patches. Review and CI are separate.
"""
import re
from engine.coder import gh
from engine.runner import run_model

ROOT = "onlykappa/KappaForge"
REPAIR_PATHS = (
    "chat-backend/src/index.js",
    "engine/runner.py",
    "engine/coder.py",
    "engine/full_reader.py",
    "engine/handoff.py",
)
# No secrets, workflows, permissions, or deployment configuration may be edited.
MAX_REPAIR_FILES = 2

def repair_proposal(api_key, issue, token=None, sha="main"):
    from engine import developer
    from engine.runner import code_providers
    body = issue.get("body") or ""
    match = re.search(r"^Repair files:\s*(.+)$", body, re.I | re.M)
    paths = [p.strip() for p in match.group(1).split(",")] if match else []
    if not paths or len(paths) > MAX_REPAIR_FILES or len(set(paths)) != len(paths) or any(p not in REPAIR_PATHS for p in paths):
        raise ValueError("Repair files must name one or two distinct allowlisted paths")
    snapshots = {path: developer.read_source(ROOT, path, sha, token) for path in paths}
    if any(not text or len(text) > developer.MAX_LARGE_FILE_CHARS for text in snapshots.values()):
        raise ValueError("Full source unavailable or exceeds the bounded edit limit")
    task = ((issue.get("title") or "") + "\n" + body +
            "\nRepair only these explicitly authorized files: " + ", ".join(paths) +
            ". Use small exact edits. Do not alter authorization, safeguards, secret handling or deployment settings.")
    budget = developer.LARGE._replace(changed_files=MAX_REPAIR_FILES)
    model, _, changes, _ = developer.generate_with(api_key, task, ROOT, snapshots,
        {p: len(t) for p, t in snapshots.items()}, "", code_providers(True), budget)
    if any(p not in paths for p in changes):
        raise ValueError("Repair included unauthorized file")
    return model, list(changes.items())


def produce_repair_pr(issue, api_key, token):
    import base64
    import urllib.error
    if (issue.get("user") or {}).get("login", "").lower() != "onlykappa":
        raise ValueError("Only owner-authored issues can authorize repairs")
    body = issue.get("body") or ""
    if not re.search(r"^Repository:\s*onlykappa/KappaForge\s*$", body, re.I | re.M) or not re.search(r"^Mode:\s*repair\s*$", body, re.I | re.M):
        raise ValueError("Explicit KappaForge repair mode required")
    number = int(issue["number"])
    branch = "kappa/repair-" + str(number)
    try:
        gh(f"repos/{ROOT}/git/ref/heads/{branch}", token)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    else:
        raise ValueError("Repair branch already exists. Review its work first.")
    main = gh(f"repos/{ROOT}/git/ref/heads/main", token)
    model, files = repair_proposal(api_key, issue, token, main["object"]["sha"])
    # The main branch remains untouched.
    gh(f"repos/{ROOT}/git/refs", token, {"ref": "refs/heads/" + branch, "sha": main["object"]["sha"]})
    for path, replacement in files:
        current = gh(f"repos/{ROOT}/contents/{path}?ref={main['object']['sha']}", token)
        gh(f"repos/{ROOT}/contents/{path}", token, {
            "message": f"fix: proposed repair for issue #{number} ({path})",
            "content": base64.b64encode(replacement.encode()).decode(),
            "branch": branch,
            "sha": current["sha"]
        }, method="PUT")
    pr = gh(f"repos/{ROOT}/pulls", token, {
        "title": f"Draft repair: KappaForge issue #{number}",
        "head": branch,
        "base": "main",
        "draft": True,
        "body": (f"Owner-approved repair for issue #{number}.\n\n"
                 f"Model: `{model}`\n\n"
                 "AI-generated replacement files. **Requires human review and independent validation before merging.** "
                 "No production deployment, secrets, workflows, or other repositories were changed.\n\n"
                 + "\n".join("- `" + path + "`" for path, _ in files))
    })
    from engine.developer import dispatch_tests
    head = gh(f"repos/{ROOT}/git/ref/heads/{branch}", token)["object"]["sha"]
    dispatch_tests(ROOT, branch, head, token, [p for p, _ in files])
    gh(f"repos/{ROOT}/issues/{number}/comments", token,
       {"body": "Self-repair draft PR created: " + pr["html_url"] + "\nManual review and tests required."})
    return pr["html_url"]
