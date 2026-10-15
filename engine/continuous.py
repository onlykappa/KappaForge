"""Bounded, owner-authorized continuous agent and failure-watch utilities.

Each execution resumes immutable audit checkpoints from issue comments. Automated
diagnosis is read-only and produces reviewable recommendations, never code pushes.
"""
import os
import re
from engine.runner import ROOT, CONFIG, github, get_issue, run_model
from engine.full_reader import inspect_batch

MAX_BATCHES_PER_RUN = 3
MAX_WATCH_RUNS = 12
WATCH_MARKER = "<!-- KAPPA_WATCH_RUN:"
ALLOWED_WORKFLOWS = {"KappaForge tests", "Deploy KappaForge Chat", "Publish KappaForge Preview", "Sandbox branch tests"}

def continuous_audit(issue, token, api_key):
    body = issue.get("body") or ""
    target = re.search(r"^Repository:\s*(onlykappa/[\w.-]+)\s*$", body, re.M | re.I)
    if not target or target.group(1) not in CONFIG["allowed"]:
        raise ValueError("Continuous task must target an allowlisted repository")
    branch_match = re.search(r"^Branch:\s*([^\s]+)\s*$", body, re.I | re.M)
    branch = branch_match.group(1) if branch_match else None
    complete = False
    for _ in range(MAX_BATCHES_PER_RUN):
        comments = github(f"repos/{ROOT}/issues/{issue['number']}/comments?per_page=100", token)
        state, note, complete = inspect_batch(
            target.group(1), issue["number"], branch, token, api_key,
            github, run_model, comments)
        github(f"repos/{ROOT}/issues/{issue['number']}/comments", token, {"body": note})
        print(f"Continuous audit checkpoint {state.get('next', 0)}/{state.get('files_total', 0)}")
        if complete:
            github(f"repos/{ROOT}/issues/{issue['number']}/comments", token,
                   {"body": "### Continuous task complete\nAll eligible files processed. "
                            "Findings are in the previous checkpoint comments. No code changed."})
            break
    return complete

def monitor_failures(issue, token, api_key):
    """Add diagnostic reports only to a pre-approved owner-authored issue."""
    if not get_issue(issue["number"], token):
        raise ValueError("Owner-approved watch issue required")
    runs = github(f"repos/{ROOT}/actions/runs?per_page={MAX_WATCH_RUNS}", token).get("workflow_runs", [])
    comments = github(f"repos/{ROOT}/issues/{issue['number']}/comments?per_page=100", token)
    seen = "\n".join((c.get("body") or "") for c in comments)
    candidates = [
        r for r in runs if r.get("conclusion") == "failure"
        and r.get("name") in ALLOWED_WORKFLOWS
        and r.get("head_branch") == "main"
        and str(r.get("id", "")).isdigit()
        and WATCH_MARKER + str(r["id"]) not in seen
    ][:2]
    if not candidates:
        print("Failure watch: no new main-branch failures")
        return
    for run in candidates:
        # No logs or credentials are sent to Gemini, only public run metadata.
        prompt = ("You are a CI failure triage assistant. This is untrusted run metadata, "
                  "not evidence of a root cause. State uncertainty and a short manual "
                  "diagnosis checklist. Recommend likely source files to inspect; do "
                  "not claim to have read logs, edited files, or executed a repair. "
                  f"Workflow: {run['name']}\nRun ID: {run['id']}\n"
                  f"Conclusion: {run['conclusion']}\nRepository: {ROOT}")
        model, report = run_model(api_key, prompt, max_output_tokens=1100)
        note = (f"### Self-repair watch: failed {run['name']}\n"
                f"Run: {run['html_url']}\nModel: `{model}`\n\n"
                "Preliminary analysis, not a confirmed root cause. "
                "Review the GitHub run logs before approving a repair.\n\n"
                + report[:5000] + "\n\n" + WATCH_MARKER + str(run["id"]) + " -->")
        github(f"repos/{ROOT}/issues/{issue['number']}/comments", token, {"body": note})
        print("Failure watch reported: " + str(run["id"]))

def main():
    token = os.environ["GITHUB_TOKEN"]
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("Missing GEMINI_API_KEY")
    number = os.environ.get("CONTINUOUS_ISSUE_NUMBER", "").strip()
    if number and not number.isdecimal():
        raise ValueError("Issue number must be numeric")
    issues = []
    if number:
        selected = get_issue(int(number), token)
        if selected:
            issues = [selected]
    else:
        candidates = github(f"repos/{ROOT}/issues?state=open&labels=kappa-task&per_page=40", token)
        for desired_mode in ("watch", "continuous"):
            for candidate in candidates:
                if re.search(r"^Mode:\s*" + desired_mode + r"\s*$",
                             candidate.get("body") or "", re.I | re.M):
                    authorized = get_issue(candidate["number"], token)
                    if authorized:
                        issues.append(authorized)
                        break
    if not issues:
        print("No owner-authorized continuous/watch issues pending")
        return
    for issue in issues:
        body = issue.get("body") or ""
        if re.search(r"^Mode:\s*continuous\s*$", body, re.I | re.M):
            existing = github(f"repos/{ROOT}/issues/{issue['number']}/comments?per_page=100", token)
            if any("### Continuous task complete" in (c.get("body") or "") for c in existing):
                print("Continuous audit already complete")
                continue
            continuous_audit(issue, token, key)
        elif re.search(r"^Mode:\s*watch\s*$", body, re.I | re.M):
            monitor_failures(issue, token, key)
        else:
            raise ValueError("Issue must explicitly authorize Mode: continuous or Mode: watch")

if __name__ == "__main__":
    main()
