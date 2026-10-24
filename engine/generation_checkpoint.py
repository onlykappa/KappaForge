"""Durable, task-bound checkpoints for generated source stages.

The recovery journal carries only a small receipt. Exact source edits live in
immutable execution blobs and become visible only after the metadata blob has
been written successfully.
"""
import re

from engine import execution, task_state


def _plan(stages):
    return [dict(text=str(stage), files=list(getattr(stage, "files", ())),
                 independent=bool(getattr(stage, "independent", False))) for stage in stages]


def identity(journal, task, repo, sources, existing, guide, stages, design, require_test):
    _goal, record = task_state.current()
    candidate = (record.identity.get("candidate") if record and isinstance(record.identity, dict) else None)
    candidate = candidate or journal.state.get("candidate", "")
    if not isinstance(candidate, str) or not re.fullmatch(r"[0-9a-f]{40}", candidate):
        raise execution.CheckpointMismatch("Generation checkpoint requires the exact authorized candidate SHA")
    plan = dict(task=task, repo=repo, sources=sources, existing=existing, guide=guide,
                stages=_plan(stages), design=design, require_test=bool(require_test))
    return dict(task=int(journal.scope.number), repo=repo, scope=journal.scope.digest,
                candidate=candidate, inputHash=execution.digest(plan))


def _receipt(journal, expected):
    receipt = journal.state.get("generationCheckpoint")
    if receipt is None:
        return None
    if not isinstance(receipt, dict) or not isinstance(receipt.get("hash"), str):
        raise execution.CheckpointMismatch("Invalid saved generation checkpoint receipt")
    if receipt.get("hash") == journal.state.get("generationPublished"):
        return None
    data = execution._read_blob(journal, receipt)
    if not isinstance(data, dict) or data.get("version") != 1 or data.get("identity") != expected:
        raise execution.CheckpointMismatch(
            "Saved generation checkpoint belongs to a different candidate, task, plan or source context")
    changes = execution._read_blob(journal, data.get("patchRef"))
    if (not isinstance(changes, dict) or len(changes) > 200
            or any(not isinstance(path, str) or (value is not None and not isinstance(value, str))
                   for path, value in changes.items())
            or not isinstance(data.get("completed"), list) or len(data["completed"]) > 100
            or any(type(index) is not int or index < 0 for index in data["completed"])
            or not isinstance(data.get("results"), dict) or len(data["results"]) > 100
            or not isinstance(data.get("summaries"), list) or len(data["summaries"]) > 20
            or not isinstance(data.get("explanations"), list) or len(data["explanations"]) > 20
            or not isinstance(data.get("unfinished"), list) or len(data["unfinished"]) > 20
            or any(not isinstance(value, str) or len(value) > 2000 for value in data["summaries"] + data["explanations"])
            or any(not isinstance(value, str) or len(value) > 500 for value in data["unfinished"])
            or execution.sanitized(changes) != changes):
        raise execution.CheckpointMismatch("Saved generated candidate contains credentials or private values")
    data["changes"] = changes
    return data


def load(journal, expected):
    if not journal:
        return None
    try:
        return _receipt(journal, expected)
    except execution.CheckpointMismatch:
        raise
    except Exception as exc:
        raise execution.CheckpointUnavailable(
            "Generation checkpoint could not be read: " + execution.clean(type(exc).__name__ + ": " + str(exc), 500)) from exc


def save(journal, expected, changes, completed, results, summaries, explanations, model, writer, unfinished):
    if execution.sanitized(changes) != changes:
        raise execution.CheckpointMismatch(
            "Generated candidate contains credentials or private environment values; generation checkpoint blocked")
    if not journal:
        return
    try:
        execution.require_storage(journal, expected["repo"])
        patch_ref = execution._write_blob(journal, changes)
        data = execution.sanitized(dict(
            version=1, identity=expected, patchRef=patch_ref,
            completed=sorted(set(int(index) for index in completed))[-100:],
            results={str(index): bool(value) for index, value in list(results.items())[-100:]},
            summaries=[execution.clean(item, 2000) for item in list(summaries)[-20:]],
            explanations=[execution.clean(item, 2000) for item in list(explanations)[-20:]],
            model=execution.clean(model, 100), writer=execution.clean(writer, 100),
            unfinished=[execution.clean(item, 500) for item in list(unfinished)[-20:]]))
        receipt = execution._write_blob(journal, data, journal.state.get("generationCheckpoint"))
        journal.state["generationCheckpoint"] = receipt
        journal.persist()
    except (execution.CheckpointMismatch, execution.CheckpointUnavailable):
        raise
    except Exception as exc:
        raise execution.CheckpointUnavailable(
            "Generation checkpoint could not be saved: " + execution.clean(type(exc).__name__ + ": " + str(exc), 500)) from exc
