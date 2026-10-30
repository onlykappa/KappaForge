# Competitor capability comparison

Audit snapshot: 2026-10-30 UTC. Default branch `main`, commit `19c95923d12156688487fd8d4e1f6dd1c16eefa6`. Documentation-only branch `audit/autonomy-2026-10-30`. No inference requests, workflow dispatches, merges, releases, deployments or production configuration changes were made by this audit.

Evidence labels: VERIFIED = directly observed implementation or execution (the evidence specifies which); PARTIAL = implementation exists with material limits; BROKEN = observed failure or deterministic incorrect behavior; MISSING = no implementation found in the inspected execution surfaces; UNVERIFIED = insufficient execution/access evidence; NOT APPLICABLE = outside the declared supported scope. Source verification is not production verification.

KappaForge is closest in architecture to a constrained GitHub coding agent with a personal chat frontend. Its application can use stronger models if available; adding more weaker-model routes does not establish ChatGPT/Claude reasoning equivalence. No proprietary internals are assumed.

Public baseline references: [ChatGPT capabilities](https://help.openai.com/en/articles/9260256-chatgpt-capabilities-overview), [ChatGPT agent](https://openai.com/index/introducing-chatgpt-agent/), [Claude](https://www.anthropic.com/claude), [Claude Code overview](https://code.claude.com/docs/en/overview), [Codex documentation](https://developers.openai.com/codex/). Codex documentation returned HTTP 200; the other documentation pages returned 403 from this environment. Therefore those baselines are public capability descriptions known in general, **UNVERIFIED for current account/plan availability as of the snapshot**, not independently tested product claims. Do not treat every row as enabled in every plan. Recollect accessible official documents and exact feature versions before publishing a numerical coverage estimate.

| Benchmark | Broad public role | KappaForge practical position | Workflow capability coverage | Relative measured task success |
|---|---|---|---|---|
| ChatGPT | General assistant, research/files/data and optional agent tools | Narrower tool/environment reach; no broad browser/office workflows observed | UNMEASURED | UNMEASURED |
| Claude | General assistant, projects/artifacts and configured integrations | Similar chat concept; less demonstrated context/workflow breadth | UNMEASURED | UNMEASURED |
| Claude Code | Repository/terminal coding agent with iterative tooling | Real iterative subset exists; brittle edit/verification/recovery | UNMEASURED | UNMEASURED |
| OpenAI Codex | Coding agent in isolated/cloud or local environments | Has sandbox/draft flow; narrower runtime flexibility and outcome evidence | UNMEASURED | UNMEASURED |
| Other production patterns | Durable job lease, event sourcing, typed tools, independent eval | Relevant engineering patterns, not intelligence benchmarks | NOT APPLICABLE | UNMEASURED |

## Intelligence/reasoning

| Capability | ChatGPT / Claude / Claude Code / Codex public surface | KappaForge observed | Existing architecture / required addition |
|---|---|---|---|
| Complex instruction following | All: model-supported reasoning; horizon, context and quality vary; internal architectures unknown | PARTIAL: #330 scope respected; requirement cap loses long requests | Existing model + requirement engine; needs complete typed constraints |
| Multi-step reasoning and decomposition | All: model-supported reasoning; horizon, context and quality vary; internal architectures unknown | PARTIAL: stages/plans and repair state; no broad success measure | Existing architecture, quality constrained by eligible models |
| Ambiguity and interactive clarification | All: model-supported reasoning; horizon, context and quality vary; internal architectures unknown | PARTIAL: ask_owner and clarification.py; not live exercised here | Existing durable clarification path; needs resumed-workflow proof |
| Context awareness and long-horizon planning | All: model-supported reasoning; horizon, context and quality vary; internal architectures unknown | PARTIAL: bounded task state, maps, checkpoints | Needs semantic compaction and project decision retrieval |
| Self-evaluation and uncertainty | All: model-supported reasoning; horizon, context and quality vary; internal architectures unknown | PARTIAL: fail-closed review, can block correct work | Needs typed evidence and calibrated verifier |
| Recognize failing approach and choose alternatives | All: model-supported reasoning; horizon, context and quality vary; internal architectures unknown | PARTIAL: strategy ledger; #322 repeated anchors and invalid_limit | Needs evidence delta and failure-family policy |
## Coding

| Capability | ChatGPT / Claude / Claude Code / Codex public surface | KappaForge observed | Existing architecture / required addition |
|---|---|---|---|
| Repository exploration, symbol/reference search, dynamic reads | ChatGPT/Claude: environment/tool dependent; Claude Code/Codex: documented coding-agent workflow | VERIFIED source tools; live #322 read_file observations | Existing tools; export index is active on main |
| Multi-file editing and refactoring | ChatGPT/Claude: environment/tool dependent; Claude Code/Codex: documented coding-agent workflow | PARTIAL: bounded JSON edits/stages; exact anchors fragile | Existing architecture; stronger patch protocol needed |
| Terminal, dependencies and isolated sandbox | ChatGPT/Claude: environment/tool dependent; Claude Code/Codex: documented coding-agent workflow | VERIFIED live test receipts; constrained Python/Node Docker profiles | Existing Actions compute; no Worker shell |
| Tests before commit and error-log inspection | ChatGPT/Claude: environment/tool dependent; Claude Code/Codex: documented coding-agent workflow | VERIFIED receipts in #330; #322 failure stops publication | Independent acceptance and negative controls still needed |
| Build complete features and debug failures | ChatGPT/Claude: environment/tool dependent; Claude Code/Codex: documented coding-agent workflow | PARTIAL: real proposals and feedback, narrow evidence | Requires measured outcomes; not model equivalence |
| Create/update draft PRs | ChatGPT/Claude: environment/tool dependent; Claude Code/Codex: documented coding-agent workflow | VERIFIED #331; Fix paths present | Existing GitHub API and scoped write token |
| Validate actual user-facing behavior | ChatGPT/Claude: environment/tool dependent; Claude Code/Codex: documented coding-agent workflow | PARTIAL: browser/native CI, open native failure #313 | Needs device and browser artifacts for exact candidate |
| Continue across sessions | ChatGPT/Claude: environment/tool dependent; Claude Code/Codex: documented coding-agent workflow | PARTIAL: saved #322 state/candidate survives; broad kill proof unrun | Needs transactional journal and restart acceptance |
## General purpose

| Capability | ChatGPT / Claude / Claude Code / Codex public surface | KappaForge observed | Existing architecture / required addition |
|---|---|---|---|
| Web research and synthesis | ChatGPT/Claude: feature/plan/tool dependent; Claude Code/Codex: via terminal/tools where configured | PARTIAL: curated documentation HTTP search only | General search adapter/service needed |
| Website interaction and browser automation | ChatGPT/Claude: feature/plan/tool dependent; Claude Code/Codex: via terminal/tools where configured | MISSING agent browser tools; Playwright CI is not browsing tool | Additional isolated browser compute/optional service |
| File creation/editing and artifacts | ChatGPT/Claude: feature/plan/tool dependent; Claude Code/Codex: via terminal/tools where configured | PARTIAL: repository sources/attachments/build artifacts | General file sandbox and downloadable artifact contract |
| Document processing and spreadsheet analysis | ChatGPT/Claude: feature/plan/tool dependent; Claude Code/Codex: via terminal/tools where configured | MISSING purpose-built office workflow tools | Libraries in isolated compute; no proprietary technology needed |
| Image understanding and multimodal I/O | ChatGPT/Claude: feature/plan/tool dependent; Claude Code/Codex: via terminal/tools where configured | UNVERIFIED model/media behavior; voice adapters exist | Eligible multimodal provider and acceptance fixtures |
| Data analysis | ChatGPT/Claude: feature/plan/tool dependent; Claude Code/Codex: via terminal/tools where configured | PARTIAL: can generate/test Python code; no demonstrated end-to-end dataset workflow | File ingress, sandbox packages and artifacts |
| API integration and external applications | ChatGPT/Claude: feature/plan/tool dependent; Claude Code/Codex: via terminal/tools where configured | PARTIAL: GitHub/weather/Discord bespoke paths | Capability/MCP adapters and scoped service credentials |
| Computer/desktop interaction | ChatGPT/Claude: feature/plan/tool dependent; Claude Code/Codex: via terminal/tools where configured | MISSING general local/desktop agent | Optional local companion or remote desktop sandbox |
| Project planning and scheduled tasks | ChatGPT/Claude: feature/plan/tool dependent; Claude Code/Codex: via terminal/tools where configured | PARTIAL: task stages, Actions/DO wakes, expiring scoped jobs | Calendar/general scheduler adapter and explicit grant lifecycle |
| User preferences and memory | ChatGPT/Claude: feature/plan/tool dependent; Claude Code/Codex: via terminal/tools where configured | PARTIAL: notes, project maps, encrypted vault sync | Cross-device/decision retrieval tests and retention policy |
## Reliability

| Capability | ChatGPT / Claude / Claude Code / Codex public surface | KappaForge observed | Existing architecture / required addition |
|---|---|---|---|
| First-attempt completion | All: no universal success guarantee; comparable rates not measured here | UNMEASURED broad rate; #330 code pass but completion blocked | Held-out objective-level tests needed |
| Recover after one or multiple failures | All: no universal success guarantee; comparable rates not measured here | PARTIAL: #322 repairs attempted without completion | Category-specific recovery and live replay required |
| Identify impossible/unsupported tasks | All: no universal success guarantee; comparable rates not measured here | PARTIAL scope/authorization checks; broad accuracy unmeasured | Capability declaration and unsupported benchmark |
| Avoid false success | All: no universal success guarantee; comparable rates not measured here | PARTIAL: incomplete draft honest; copied-test evidence weakness | Typed completion and independent oracle |
| Provider outages | All: no universal success guarantee; comparable rates not measured here | VERIFIED free fallback #330; strong routes failed | Capacity/quality calibration and outage replay |
| Preserve progress after restart | All: no universal success guarantee; comparable rates not measured here | PARTIAL checkpoint implementation and retained candidate | Process-kill integration evidence |
| Complete long objectives | All: no universal success guarantee; comparable rates not measured here | UNMEASURED; finite plans/grants/budgets | Long-horizon benchmark and durable state |
| Maintain security boundaries | All: no universal success guarantee; comparable rates not measured here | PARTIAL guards/sandbox; workflow premerge risk | Adversarial tests and deployed permission evidence |

No feature here inherently requires inaccessible proprietary agent technology: models/services, browser runtime, scoped credentials and execution infrastructure are ordinary external dependencies. Training a flagship model is outside this application's scope. Local computer access requires owner-installed execution capability; paid services and recurring compute require explicit decisions. Compare through equivalent fixture repositories, accounts, tool grants, versions and task budgets using report08, and report unsupported features separately. A coverage percentage needs a declared task/capability denominator and validated availability for both products; none is sufficiently established here.
