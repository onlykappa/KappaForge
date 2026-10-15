"""Two-attempt autonomous repair of owner-approved sandbox coding drafts.

Never checks out or executes candidate code on the privileged runner.
Only edits already generated sandbox paths after independent, secret-free CI fails.
"""
import base64
import json
import re
from engine.coder import gh, validate_files
from engine.runner import ROOT, run_model

BRANCH = re.compile(r"^kappa/(?:issue-\d+|cont-\d+-\d+)$")
MAX_REVISIONS = 2
MARKER = "<!-- KAPPA_AUTOFIX:"

def candidate(run):
    match = re.search(r"Sandbox validation (kappa/[A-Za-z0-9/-]+) @ ([a-f0-9]{40})", run.get("display_title",""))
    branch = match.group(1) if match else ""
    return branch if (run.get("name")=="Sandbox branch tests" and
                      run.get("conclusion")=="failure" and BRANCH.fullmatch(branch)) else None

def revision_count(comments,branch):
    return sum(MARKER+branch+":" in (c.get("body") or "") for c in comments)

def revise_failed_run(run,token,key):
    branch=candidate(run)
    if not branch:return {"status":"ignored"}
    pulls=gh(f"repos/{ROOT}/pulls?state=open&head=onlykappa:{branch}",token)
    prs=[p for p in pulls if p.get("draft") and p.get("head",{}).get("ref")==branch]
    if len(prs)!=1:return {"status":"no_authorized_draft"}
    pr=prs[0]
    # Never overwrite a branch whose head changed since the failed run.
    current=gh(f"repos/{ROOT}/git/ref/heads/{branch}",token)["object"]["sha"]
    match = re.search(r" @ ([a-f0-9]{40})", run.get("display_title",""))
    if not match or current!=match.group(1):
        return {"status":"superseded"}
    comments=gh(f"repos/{ROOT}/issues/{pr['number']}/comments?per_page=100",token)
    if any(MARKER+branch+":"+str(run["id"]) in (c.get("body") or "") for c in comments):
        return {"status":"already_processed"}
    if revision_count(comments,branch)>=MAX_REVISIONS:
        return {"status":"retry_cap"}
    changed=gh(f"repos/{ROOT}/pulls/{pr['number']}/files?per_page=30",token)
    paths=[x["filename"] for x in changed if x.get("status") in ("added","modified")]
    if not paths or len(paths)>4: return {"status":"unsafe_diff"}
    if [p for p,_ in validate_files([{"path":p,"content":""} for p in paths])]!=paths:
        return {"status":"unsafe_diff"}
    source=[]
    for p in paths:
        item=gh(f"repos/{ROOT}/contents/{p}?ref={branch}",token)
        if item.get("encoding")!="base64":return {"status":"unsupported_content"}
        raw=base64.b64decode(item["content"]).decode("utf-8")
        source.append({"path":p,"content":raw[:18000]})
    jobs=gh(f"repos/{ROOT}/actions/runs/{int(run['id'])}/jobs?per_page=30",token).get("jobs",[])
    errors=[step.get("name","") for job in jobs for step in job.get("steps",[])
            if step.get("conclusion")=="failure"][:6]
    prompt=("An independent secret-free test workflow failed. Repair only the listed preexisting "
            "sandbox source files. No new files. Do not access secrets, modify CI or add network calls. "
            "Return strict JSON with exactly the same paths in files[]. "
            "A failed step name does not identify the root cause; make minimal evidence-based corrections. "
            "Failed steps: "+json.dumps(errors)+"\n"
            "Original owner-approved sandbox files: "+json.dumps(source)[:42000])
    model, answer=run_model(key,prompt,max_output_tokens=8192)
    try:
        fixed=validate_files(json.loads(answer.strip().removeprefix("```json").removesuffix("```").strip())["files"])
        if set(p for p,_ in fixed)!=set(paths):return {"status":"unexpected_paths"}
        import ast
        for p,body in fixed:
            if p.endswith(".py"):ast.parse(body,filename=p)
    except (ValueError,KeyError,TypeError,SyntaxError,json.JSONDecodeError):
        return {"status":"bad_repair"}
    # Record attempt BEFORE changing source so retries cannot bypass the cap.
    gh(f"repos/{ROOT}/issues/{pr['number']}/comments",token,
       {"body":f"Autofix attempt for failed run {run['id']} using {model}. "
               f"Source paths restricted to prior diff. {MARKER}{branch}:{run['id']} -->"})
    for path,body in fixed:
        existing=gh(f"repos/{ROOT}/contents/{path}?ref={branch}",token)
        if base64.b64decode(existing["content"]).decode("utf-8")==body:continue
        gh(f"repos/{ROOT}/contents/{path}",token,
           {"branch":branch,"sha":existing["sha"],
            "message":f"fix: bounded sandbox validation retry for PR #{pr['number']}",
            "content":base64.b64encode(body.encode()).decode()},method="PUT")
    gh(f"repos/{ROOT}/actions/workflows/sandbox-tests.yml/dispatches",token,
       {"ref":"main","inputs":{"branch":branch,"candidate_sha":gh(f"repos/{ROOT}/git/ref/heads/{branch}",token)["object"]["sha"]}})
    return {"status":"revised","branch":branch}

def scan_failures(token,key,github):
    runs=github(f"repos/{ROOT}/actions/workflows/sandbox-tests.yml/runs?per_page=20",token).get("workflow_runs",[])
    outcomes=[]
    for run in runs:
        if not candidate(run):continue
        result=revise_failed_run(run,token,key)
        outcomes.append(result)
        if result.get("status")=="revised":break
    return outcomes
