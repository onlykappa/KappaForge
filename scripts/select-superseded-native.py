"""Select active main-branch iOS runs from the current repository, never arbitrary workflows."""
import json
import re
import sys

ACTIVE = {"queued", "in_progress", "waiting", "pending", "requested"}


def select_runs(pages, current_sha):
    if not re.fullmatch(r"[0-9a-f]{40}", current_sha):
        raise ValueError("Invalid current commit SHA")
    found = set()
    for page in pages:
        for run in page.get("workflow_runs", []):
            if (run.get("path") == ".github/workflows/ios-build.yml"
                    and run.get("repository", {}).get("full_name") == "onlykappa/KappaForge"
                    and run.get("head_branch") == "main"
                    and run.get("status") in ACTIVE
                    and re.fullmatch(r"[0-9a-f]{40}", run.get("head_sha", ""))
                    and run["head_sha"] != current_sha
                    and type(run.get("id")) is int and run["id"] > 0):
                found.add(run["id"])
    return sorted(found)


if __name__ == "__main__":
    for number in select_runs(json.load(sys.stdin), sys.argv[1]):
        print(number)
