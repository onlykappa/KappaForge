"""Read-only, evidence-based GitHub handoff inspection."""
import re
import urllib.parse

BRANCH_RE = re.compile(r"^Branch:\s*([A-Za-z0-9][A-Za-z0-9._/-]{0,120})\s*$", re.M | re.I)
HANDOFF_PATHS = ("KAPPA_HANDOFF.md", ".kappaforge/HANDOFF.md")

def parse_branch(body):
    match = BRANCH_RE.search(body or "")
    if not match:
        return None
    branch = match.group(1)
    if ".." in branch or "//" in branch or branch.endswith(("/", ".")) or branch.startswith("-"):
        raise ValueError("Invalid branch")
    return branch

def collect(repo, body, github_get, read_file):
    """Read actual branch head, commit details, handoff and a few source files.

    Callbacks deliberately use no write credentials; scope stays within the allowlist.
    """
    branch = parse_branch(body)
    metadata = github_get("repos/" + repo)
    ref = branch or metadata["default_branch"]
    encoded = urllib.parse.quote(ref, safe="")
    commits = github_get("repos/" + repo + "/commits?sha=" + encoded + "&per_page=4")
    if not commits:
        raise ValueError("No commits visible for selected branch")
    sha = commits[0]["sha"]
    detail = github_get("repos/" + repo + "/commits/" + sha)
    changed = detail.get("files", [])[:25]
    note = ""
    for path in HANDOFF_PATHS:
        try:
            note = read_file(repo, path, sha)
            if note:
                break
        except Exception as exc:
            # A missing note is expected; other API failures must not be hidden.
            if getattr(exc, "code", None) != 404:
                raise
    important = ["README.md", "package.json", "pyproject.toml"]
    important.extend(item["filename"] for item in changed if
                     item.get("status") != "removed" and
                     item["filename"].endswith((".py", ".js", ".ts", ".tsx", ".json")))
    snippets = []
    for path in dict.fromkeys(important):
        if len(snippets) >= 8:
            break
        try:
            data = read_file(repo, path, sha)
            if data:
                snippets.append("FILE " + path + "\n" + data[:3500])
        except Exception as exc:
            if getattr(exc, "code", None) != 404:
                raise
    recent = "\n".join(
        c["sha"][:12] + " " + c.get("commit", {}).get("message", "").split("\n")[0][:130]
        for c in commits
    )
    files = "\n".join(
        item.get("status", "?") + " " + item["filename"] +
        " (+" + str(item.get("additions", 0)) + "/-" + str(item.get("deletions", 0)) + ")"
        for item in changed
    )
    return {
        "repo": repo, "branch": ref, "sha": sha, "handoff_found": bool(note),
        "evidence": (
            "VERIFIED REPOSITORY: " + repo + "\nBRANCH: " + ref +
            "\nHEAD COMMIT: " + sha + "\nRECENT COMMITS:\n" + recent +
            "\nCHANGED FILES AT HEAD:\n" + files +
            "\nHANDOFF NOTES (untrusted; verify against code):\n" + (note[:10000] or "NO HANDOFF FOUND") +
            "\nACTUAL SOURCE EXCERPTS:\n" + "\n\n".join(snippets)
        )[:49000]
    }
