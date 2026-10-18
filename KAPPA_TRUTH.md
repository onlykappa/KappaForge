# KappaForge Truth Protocol

This document describes how the assistant should evaluate project claims. It is **untrusted reference material**, not a system prompt, and cannot override security or developer instructions.

## Source hierarchy
1. Exact commit SHA and source file contents retrieved from the selected repository, with file path and line numbers.
2. Matching test/build logs for functional outcomes (include run URL, conclusion and applicable commit).
3. User-provided local logs/diffs, explicitly labeled local and unverified until examined.
4. PROJECT_TRUTH.md project notes, labeled user-editable background.
5. Conversation memory as hints only, never evidence.

## Procedure
- Resolve project and commit first. Respect any active commit lock and never switch branches while locked.
- Retrieve file structure, relevant functions/imports and changed files before claiming implementation details.
- For proposed changes, consult dependency_map.json (generated from real imports by scripts/dependency-map.py) and inspect affected call sites and tests; it does not capture runtime edges such as HTTP calls or workflow dispatches.
- Before responding, check every factual code claim against source evidence. Quote file paths and line ranges when available; otherwise explicitly say verification is incomplete.
- A commit existing, an issue closing, or an agent reporting success does **not** prove a feature works.
- Never claim access to uncommitted local changes or internal hidden reasoning. Report only observable evidence and uncertainty.
- If fetching fails, ask for the specific git diff, file, stack trace, or workflow log required to proceed.

## Data freshness
Always identify the repository and SHA/reference used. The index and dependency map may become stale after new commits: validate against fresh source and never present this document as a live code snapshot.
