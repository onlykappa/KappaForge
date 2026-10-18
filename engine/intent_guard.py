"""Deterministic task boundary for every privileged GitHub invocation.

Repository instructions, model plans and logs cannot replace an owner task.
Re-read that task before each mutation so closure/cancellation takes effect.
"""
import hashlib
import json
import re
import time
from contextvars import ContextVar
from datetime import datetime
from urllib.parse import urlparse

ACTIVE = ContextVar("execution_scope", default=None)
READ_MODES = {"analysis", "audit", "project-map", "continuous", "watch"}
WRITE_MODES = {"develop", "code", "repair", "continuous-code"}
MARKER = re.compile(r"^<!-- kappa-authorization:(\{[^\n]+\}) -->$", re.M)


def timestamp(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return 0


class ExecutionScope:
    def __init__(self, issue, now=None):
        now = time.time() if now is None else now
        if issue.get("state") != "open" or issue.get("user", {}).get("login", "").lower() != "onlykappa":
            raise PermissionError("An open owner-authored task is required")
        self.release_pr = self.release_sha = self.release_node = None
        self.number = int(issue["number"])
        self.body = issue.get("body") or ""
        modes = re.findall(r"^Mode:\s*([\w-]+)\s*$", self.body, re.M | re.I)
        repos = re.findall(r"^Repository:\s*(onlykappa/[\w.-]+)\s*$", self.body, re.M | re.I)
        if len(modes) != 1 or len(repos) != 1 or modes[0] not in READ_MODES | WRITE_MODES:
            raise PermissionError("Task mode and repository must be unambiguous")
        self.mode, self.repo = modes[0], repos[0]
        matches = MARKER.findall(self.body)
        if "Approved from KappaForge Chat." in self.body:
            if len(matches) != 1:
                raise PermissionError("Chat task has no valid user authorization provenance")
            record = json.loads(matches[0])
            if record.get("repo") != self.repo or record.get("mode") != self.mode or not record.get("conversationId") or not record.get("requestId"):
                raise PermissionError("Authorization does not match the task scope")
            self.expires = record.get("expiresAt", 0) / 1000
            self.identity = record.get("id")
        else:
            # Owner-created GitHub tasks remain supported, bounded to one day.
            self.expires = timestamp(issue.get("created_at")) + 86400
            self.identity = "github-task:" + str(self.number)
        if self.expires <= now:
            raise PermissionError("Task authorization expired; resumption needs a fresh user request")
        self.digest = hashlib.sha256(self.body.encode()).hexdigest()
        self.state = "authorized"
        self.recoveries = 0
        self.rejected = set()

    def transition(self, state):
        edges = {"authorized": {"planning", "cancelled"}, "planning": {"executing", "cancelled", "failed"},
                 "executing": {"verifying", "failed", "cancelled"}, "verifying": {"completed", "executing", "failed", "cancelled"}}
        if state not in edges.get(self.state, set()):
            raise PermissionError("Invalid execution lifecycle transition")
        self.state = state

    def recover(self, signature, limit=5):
        if self.state in {"cancelled", "completed", "failed"} or signature in self.rejected or self.recoveries >= limit:
            raise PermissionError("Recovery budget exhausted or rejected edit repeated")
        self.rejected.add(signature)
        self.recoveries += 1

    def check_current(self, current, now=None):
        if self.expires <= (time.time() if now is None else now) or self.state in {"cancelled", "completed", "failed"}:
            raise PermissionError("Task authorization is no longer active")
        if current.get("state") != "open" or current.get("user", {}).get("login", "").lower() != "onlykappa" or hashlib.sha256((current.get("body") or "").encode()).hexdigest() != self.digest:
            self.state = "cancelled"
            raise PermissionError("Task cancelled or scope changed; queued mutation rejected")

    def permit(self, path, payload, method):
        parsed = urlparse(path)
        if parsed.netloc != "api.github.com":
            raise PermissionError("Execution scope cannot authorize an external endpoint")
        p = parsed.path
        if self.mode in WRITE_MODES and self.state == "verifying" and self.release_pr and self.release_sha:
            if p == f"/repos/{self.repo}/pulls/{self.release_pr}/merge" and method == "PUT" and payload == {"sha": self.release_sha, "merge_method": "squash"}:
                return
            if p == "/graphql" and method == "POST" and payload == {"query": "mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft}}}", "variables": {"id": self.release_node}}:
                return
        # Reporting is bound to the current task; cannot create child tasks.
        if p == f"/repos/onlykappa/KappaForge/issues/{self.number}/comments" and method == "POST":
            if set(payload or {}) != {"body"} or str(payload["body"]).startswith("Guidance:"):
                raise PermissionError("Reports cannot issue owner guidance")
            return
        if self.mode in READ_MODES:
            # Read-only audit continuation may dispatch only the same task.
            if p == "/repos/onlykappa/KappaForge/actions/workflows/agent.yml/dispatches" and (payload or {}).get("inputs") == {"issue_number": str(self.number)}:
                return
            raise PermissionError("Investigation cannot modify repository state")
        if not p.startswith(f"/repos/{self.repo}/"):
            # Test dispatches run on trusted KappaForge workflows for the same branch.
            if p.startswith("/repos/onlykappa/KappaForge/actions/workflows/") and p.endswith("/dispatches"):
                inputs = (payload or {}).get("inputs", {})
                if self.branch(inputs.get("branch", "")):
                    return
            raise PermissionError("Mutation targets a repository outside the task")
        suffix = p.removeprefix(f"/repos/{self.repo}/")
        if suffix in {"git/blobs", "git/trees", "git/commits"} and method == "POST":
            return
        if suffix == "git/refs" and self.branch((payload or {}).get("ref", "").removeprefix("refs/heads/")):
            return
        if suffix.startswith("git/refs/heads/") and self.branch(suffix.removeprefix("git/refs/heads/")) and not (payload or {}).get("force"):
            return
        if suffix == "pulls" and method == "POST" and (payload or {}).get("draft") is True and self.branch((payload or {}).get("head", "")):
            return
        if suffix.startswith("actions/workflows/") and suffix.endswith("/dispatches") and self.branch((payload or {}).get("inputs", {}).get("branch", "")):
            return
        if suffix.startswith("contents/") and method == "PUT" and self.branch((payload or {}).get("branch", "")):
            return
        raise PermissionError("Tool invocation is outside the authorized draft workflow")

    def branch(self, branch):
        return bool(re.fullmatch(r"kappa/(?:dev|issue|repair)-" + str(self.number) + r"|kappa/cont-" + str(self.number) + r"-\d+", branch))


def activate(issue):
    scope = ExecutionScope(issue)
    scope.transition("planning")
    ACTIVE.set(scope)
    return scope


def guard_request(url, payload, method, read_current):
    if urlparse(url).netloc != "api.github.com" or method in {"GET", "HEAD"}:
        return
    scope = ACTIVE.get()
    if scope is None:
        raise PermissionError("Privileged tool invocation has no user-authorized execution scope")
    scope.check_current(read_current(scope.number))
    scope.permit(url, payload, method)
    if scope.state == "planning":
        scope.transition("executing")


def report_state(scope, body):
    if body.startswith("### KappaForge task failed"):
        return "failed"
    if scope.mode in READ_MODES and (body.startswith(("### KappaForge run completed", "### KappaForge project map complete", "### Continuous task complete")) or "**Status:** All eligible paths processed" in body):
        return "completed"
    return scope.state


def report_provenance(url, payload):
    scope = ACTIVE.get()
    if scope and urlparse(url).path == f"/repos/onlykappa/KappaForge/issues/{scope.number}/comments" and isinstance(payload, dict) and isinstance(payload.get("body"), str):
        state = report_state(scope, payload["body"])
        return {**payload, "body": payload["body"] + "\n<!-- kappa-lifecycle:" + json.dumps({"authorizationId": scope.identity, "state": state, "expiresAt": int(scope.expires * 1000)}, separators=(",", ":")) + " -->"}
    return payload


def record_success(url, payload):
    scope = ACTIVE.get()
    if not scope:
        return
    if urlparse(url).path.endswith("/dispatches") and scope.state == "executing":
        scope.transition("verifying")
    body = (payload or {}).get("body", "") if isinstance(payload, dict) else ""
    state = report_state(scope, body)
    if state == "completed" and scope.state != "completed":
        if scope.state == "executing":
            scope.transition("verifying")
        scope.transition("completed")
    elif state == "failed" and scope.state in {"planning", "executing", "verifying"}:
        scope.transition("failed")
