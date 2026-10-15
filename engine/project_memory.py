"""Versioned and bounded project memory from verified read-only index reports.

Memory is stored as issue comments rather than committing to repository source.
Only known repository and SHA-qualified reports are accepted.
"""
import json
import re

MAX_MEMORY_BYTES=38000
MARKER="<!-- KAPPA_PROJECT_MEMORY_V1"

def snapshot(report):
    repo=report.get("repo","")
    sha=report.get("commit","")
    if repo not in ("onlykappa/KappaForge","onlykappa/OmniPC","onlykappa/Apk-revival"):
        raise ValueError("Unapproved memory repository")
    if not re.fullmatch(r"[0-9a-f]{40}",sha):
        raise ValueError("Memory requires full immutable commit SHA")
    safe={"version":1,"repo":repo,"commit":sha,"total_indexed":int(report.get("total_indexed",0)),
          "extensions":report.get("extensions",{}),"files":report.get("files",[])[:20],
          "paths":report.get("paths",[])[:300],"truncated":bool(report.get("truncated"))}
    payload=json.dumps(safe,ensure_ascii=True,separators=(",",":"))
    if len(payload.encode())>MAX_MEMORY_BYTES:
        safe["paths"]=safe["paths"][:100]
        payload=json.dumps(safe,ensure_ascii=True,separators=(",",":"))
    if len(payload.encode())>MAX_MEMORY_BYTES:
        raise ValueError("Memory snapshot exceeds size cap")
    return MARKER+" repo="+repo+" sha="+sha+" -->\n```json\n"+payload+"\n```"

def extract_latest(comments,repo):
    for comment in reversed(comments):
        body=comment.get("body") or ""
        if MARKER+" repo="+repo+" sha=" not in body:continue
        match=re.search(r"```json\s*(\{[\s\S]*?\})\s*```",body)
        if not match:continue
        try:
            obj=json.loads(match.group(1))
            if obj.get("repo")==repo and re.fullmatch(r"[0-9a-f]{40}",obj.get("commit","")):
                return obj
        except (ValueError,TypeError):continue
    return None

def change_summary(previous,current):
    if not previous:return {"status":"first_snapshot","commit":current["commit"]}
    before=set(previous.get("paths",[]));after=set(current.get("paths",[]))
    return {"status":"unchanged" if previous.get("commit")==current["commit"] else "updated",
            "previous_commit":previous["commit"],"commit":current["commit"],
            "added_paths":sorted(after-before)[:30],"removed_paths":sorted(before-after)[:30]}


def recent_repo_memory(repo, github, token, current_issue=None, max_issues=12):
    """Find the latest verified repository snapshot across bounded owner tasks."""
    if repo not in ("onlykappa/KappaForge","onlykappa/OmniPC","onlykappa/Apk-revival"):
        raise ValueError("Repository not authorized")
    from engine.runner import ROOT
    issues=github(f"repos/{ROOT}/issues?state=all&labels=kappa-task&per_page={max_issues}&sort=updated&direction=desc",token)
    for issue in issues[:max_issues]:
        if "pull_request" in issue or issue.get("user",{}).get("login","").lower()!="onlykappa":
            continue
        number=issue.get("number")
        if not isinstance(number,int) or number==current_issue:
            continue
        body=issue.get("body") or ""
        if not re.search(r"^Repository:\s*"+re.escape(repo)+r"\s*$",body,re.I|re.M):
            continue
        if not re.search(r"^Mode:\s*project-map\s*$",body,re.I|re.M):
            continue
        comments=github(f"repos/{ROOT}/issues/{number}/comments?per_page=100",token)
        value=extract_latest(comments,repo)
        if value:
            return value
    return None
