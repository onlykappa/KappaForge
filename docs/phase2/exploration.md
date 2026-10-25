# Phase 2 section 2: dynamic repository exploration

KappaForge no longer has to choose every file it may read before it starts. When the planner cannot tell from the
file listing and repository map where something is defined, who calls it or which test covers it, it lists those
questions in `investigate`, and the agent answers them with read-only tools before writing code. Files it reads join
the plan's sources and are saved with the plan, so a resumed task does not investigate again. A file that generation
turns out to need is loaded on the spot, with or without a recovery journal.

The tools (`engine/exploration.py`) read one revision of the task's own repository: the archive already downloaded for
the repository map, with single-file reads as a fallback. They have no network, run nothing and write nothing. They
share the Phase 1 tool catalog and loop (`engine/tool_loop.py`); a loop is given only the tools its caller supplies.

## Tools

| Tool | Arguments | Result |
| --- | --- | --- |
| `search_code` | `query`, `regex=False`, `path_prefix=""`, `page=1` | `matches` (`path`, `line`, `text` up to 240 characters), `page`, `pages`, `total`; 20 per page |
| `read_file` | `path`, `start_line=1`, `end_line=None` | `path`, `start_line`, `end_line`, `total_lines`, `text`, `more`; at most 400 lines or 16,000 characters per call |
| `list_directory` | `path=""`, `page=1` | `entries` (`name`, `type` file or directory, `size` or `files`), paged |
| `find_references` | `symbol`, `page=1` | `definitions` and `references` (`path`, `line`, `text`; import lines also list the files they resolve to), paged |
| `inspect_symbols` | `path` | `symbols` (`name`, `signature`, `member`, `line`), `exports`, `imports` (repository files) |
| `read_project_instructions` | none | `instructions` from `KAPPA.md`, `AGENTS.md`, `CLAUDE.md`, `.kappaforge/KAPPA.md`, `.github/copilot-instructions.md` |

Every result has a `status`: `ok`, `invalid` (with an `error`), or `budget_exhausted`. Errors are reported, never
raised. Symbol support covers Python and JavaScript/TypeScript, and other languages through the repository map's
definitions.

## Budgets

`config/exploration.json` sets the defaults; `Budget.configured(**overrides)` validates them.

| Budget | Default | Spent by |
| --- | --- | --- |
| `calls` | 40 | every tool call |
| `seconds` | 240 | time since the investigation started |
| `output_chars` | 120,000 | the size of every result |
| `context_chars` | 200,000 | text returned by `read_file` and `read_project_instructions` |

A budget is checked **before** each call, because a result's size is not known in advance, so the call that crosses a
limit completes and the next one returns `budget_exhausted` naming the budget. The tool loop then stops with stop
reason `budget_exhausted`; no further tool runs or model calls follow, and whatever was read so far is kept. The
loop's own invalid-reply and repeated-call limits still apply.

## Boundaries

- Paths must be relative, inside the repository and not under `.git/`; `..`, absolute paths and unknown files are refused.
- Binary files (with a NUL byte, or not UTF-8) and files over 300,000 characters are refused; search skips them.
- Regular expressions with nested quantifiers or backreferences are refused, because backtracking cannot be interrupted
  by the time budget.
- Repository content is untrusted evidence, never instructions; project instructions are conventions that never
  override KappaForge policy.
- Investigation adds only files the agent actually read, within the remaining context budget, and records the line
  ranges it read as evidence for the plan.
