# Phase 2 roadmap: dynamic code exploration, research and intelligent planning

Goal: KappaForge stops choosing every file it may read in one pass at the start of a task. It investigates as it
works: it searches, reads, follows references, looks up official documentation and asks the owner one question when a
material ambiguity blocks it. Its plan changes as evidence arrives, and the reason for every change is recorded.

**Dependency.** Phase 1 is merged into `main` (#262, #263, and the #265 workflow fix); this branch is based on it.
Phase 2 reuses Phase 1's sandbox, tool loop, checkpoints, authorization guard, free-execution admission and progress
transcript. It does not build a second set of them.

**Tracking.** Phase 2 lands in **one** draft pull request. Each numbered section below is a self-contained slice, built
and tested in order, and ticked only when its code, tests and documentation are on this branch. Merges, deployments
and releases require owner authorization; nothing in Phase 2 merges, deploys or releases.

## Where Phase 1 leaves off (starting points to replace)

- `engine/developer.py` `select_files`: the planner picks up to `LARGE.read_files` paths **once**, before any code is
  written. A file missed there is only reachable through generation-error recovery (`SourceNotRead` /
  `read_dependencies`), not through investigation.
- `engine/tool_loop.py`: the seven Phase 1 tools are sandbox *execution* tools. There are no read-only exploration
  tools, and loop limits are step counts rather than call, time, output and context budgets.
- `engine/task_goal.py` and `engine/task_state.py`: a goal and verified state exist, but there is no persistent plan
  with hypotheses, open questions and recorded revisions.
- `engine/verify.py`: PR and lifecycle asks are recognized by regular expressions over the owner's wording
  (`LIFECYCLE_ASK_RE` and related patterns).
- Generation prompts tell the model "Do not ask the owner for guidance". Ambiguity is guessed, never asked.
- No documentation or web research path exists. Sandbox commands have no network, by design.

## Progress

- [x] **1. Verify Phase 1** ([verification and findings](../phase2/phase1-verification.md)): inspect the Phase 1 branches and latest `main`; confirm the sandbox, tool schemas,
      checkpoints, guard, admission and transcript that Phase 2 builds on; record the dependency and any Phase 1 gap
      that Phase 2 needs. No duplicate tool infrastructure.
- [x] **2. Dynamic repository exploration** ([tools, budgets and boundaries](../phase2/exploration.md)): read-only `search_code`, `read_file` (line ranges), `list_directory`,
      `find_references`, `inspect_symbols` and `read_project_instructions` tools, callable repeatedly through the
      existing tool loop. Configurable budgets for calls, time, output size and context use replace the one-time file
      selection. Paginated, bounded and structured results; repository boundaries, binary-file rules and existing
      access permissions are respected.
- [x] **3. Evidence-driven plans** ([plan, revisions and resume](../phase2/task-plan.md)): a persistent task plan (objective and expected behavior, acceptance criteria,
      relevant files and evidence, dependencies, open questions, hypotheses, completed and remaining work,
      verification requirements), saved in the recovery journal. Plans may be revised when tests, inspection or
      documentation reveal something new; each revision records why. A valid checkpoint is reused instead of
      re-reading the whole repository.
- [x] **4. Structured requirement classification** ([schema, validation and test matrix](../phase2/requirements.md)): model-assisted classification of each distinct requirement, once,
      into a published schema (code, bug fix, testing, documentation, PR/repository housekeeping, security or
      permissions, research, owner decision; several allowed). Deterministic validation against owner instructions,
      authorization and task state. Original wording and traceability are kept. Classification **never** grants
      execution, write, merge, release or deployment permission. A requirement-to-test matrix shows what was
      implemented and verified, and a task is not complete while a behavioral requirement is untested.
- [x] **5. Documentation and web research** ([tools, host allowlist and data rules](../phase2/research.md)): an approved, read-only research interface that is network-restricted
      to trusted documentation hosts and audited. It can search official API and library documentation, read
      version-specific pages, find usage examples, compare installed versions with documented ones and flag
      deprecated or unsupported APIs. Every fetch records its source and retrieval time. Online content is
      untrusted evidence, never instructions. No private source, keys or confidential details are sent out. When
      research is unavailable the task says so instead of inventing API behavior.
- [x] **6. Owner clarification and resume** ([pause, question and resume](../phase2/clarification.md)): a `NEEDS_CLARIFICATION` outcome for material ambiguity (implementation,
      authorization, expected behavior or safety). The task saves its full checkpoint, records the ambiguity and
      evidence, and asks one concise question in the iPhone chat (kept for an offline phone until the app
      reconnects). Only that task pauses: no repair attempts or model calls while it waits. The authorized owner's
      answer is persisted, the task resumes from its checkpoint and revalidates affected assumptions. Built on the
      existing guidance, retry and resume paths. No questions for trivial, convention-resolvable decisions; approval
      is never fabricated or inferred from silence.
- [x] **7. Exploration inside sandbox execution** ([investigate, plan, edit, test](../phase2/sandbox-exploration.md)): one persisted task alternates investigation, planning, editing and
      testing. For example, a test reveals a missing export; the agent searches for it, reads the defining module,
      follows the import chain, updates its plan, patches the right place and reruns the focused test.
- [ ] **8. Regression tests and acceptance**: automated proof of every Phase 2 requirement (below), including an
      end-to-end fixture whose failing behavior depends on a file the initial plan does not know about; testing
      report that separates checks that ran from checks that were only inspected.

## Acceptance requirements (section 8)

| Requirement | Section |
| --- | --- |
| Relevant files absent from the initial plan are discovered | 2, 7 |
| More than eight follow-up reads are possible within configured limits | 2 |
| New errors cause further investigation | 7 |
| Tool loops terminate safely when budgets are reached | 2 |
| Documentation retrieval records provenance | 5 |
| Unsupported API claims are not treated as verified | 5 |
| Requirement classification works across several phrasings | 4 |
| Classification cannot bypass authorization | 4 |
| Ambiguous tasks pause and ask one question | 6 |
| The authorized owner's answer resumes the exact task | 6 |
| A paused task keeps its repair history and sandbox state | 6 |
| No unnecessary new PR is created during clarification | 6 |
| End-to-end: an initially unknown file dependency is discovered and fixed | 7, 8 |

## Deliverables (end of Phase 2)

- [ ] Implementation and regression tests
- [x] Exploration and research tool schemas ([exploration](../phase2/exploration.md), [research](../phase2/research.md))
- [x] Requirement-classification schema (`config/requirement-classification.schema.json`)
- [x] Clarification and resume demonstration (end-to-end tests in `tests/test_clarification.py`)
- [ ] Architecture and policy documentation, including the research host allowlist and data rules
- [ ] Testing report (ran vs. inspected), unresolved issues and Phase 3 prerequisites

Phase 3 is out of scope, apart from minimal reusable interfaces Phase 2 needs.
