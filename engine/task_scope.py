"""Route trusted task metadata before giving a job its narrowly scoped token."""
import os
import re
import sys
from engine.runner import choose_issue


def mode_of(issue):
    matches = re.findall(r"^Mode:\s*([\w-]+)\s*$", issue.get("body") or "", re.M | re.I)
    if not matches:
        return "analysis"
    if len(matches) != 1:
        raise ValueError("Task must specify exactly one Mode line")
    return matches[0].lower()


def require_scope(mode, scope, family="agent"):
    allowed = ({"read": {"analysis", "audit", "project-map"}, "write": {"code", "repair"}}
               if family == "agent" else
               {"read": {"continuous", "watch"}, "write": {"continuous-code"}})
    if mode not in allowed.get(scope, set()):
        raise ValueError("Task mode is outside this job's permission scope")


def main():
    token = os.environ["GITHUB_TOKEN"]
    family = "continuous" if sys.argv[1:] == ["continuous"] else "agent"
    explicit = os.getenv("INPUT_ISSUE_NUMBER", "").strip()
    if explicit == "smoke" and family == "agent":
        scope, number = "read", "smoke"
    elif family == "continuous" and not explicit:
        scope, number = "queues", ""
    else:
        allowed = None
        if not explicit:
            allowed = {"analysis", "audit", "project-map"}
        issue = choose_issue(token, allowed_modes=allowed)
        scope, number = "skip", ""
        if issue:
            mode = mode_of(issue)
            scope = "write" if mode in {"code", "repair", "continuous-code"} else "read"
            require_scope(mode, scope, family)
            if family == "agent" and scope == "write" and os.getenv("GITHUB_EVENT_NAME") != "workflow_dispatch":
                scope = "skip"
            number = str(int(issue["number"]))
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"scope={scope}\nissue={number}\n")


if __name__ == "__main__":
    from tools.diagnostics import run
    raise SystemExit(run(main, "task_scope"))
