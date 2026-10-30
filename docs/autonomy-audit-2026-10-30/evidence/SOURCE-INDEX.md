# Source evidence index

All links pinned to main19c95923d12156688487fd8d4e1f6dd1c16eefa6. Symbols are source evidence, not proof of successful deployment.

## engine/runner.py

- [def allowed_repo(repo):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L26)
- [def notify(text):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L29)
- [def is_private(repo, token=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L41)
- [def read_token(repo, token=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L48)
- [def github_response(req):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L57)
- [def request(url, payload=None, token=None, method=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L76)
- [def github(path, token=None, payload=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L104)
- [def get_issue(number, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L107)
- [def choose_issue(token, allowed_modes=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L117)
- [def authorized(issue):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L136)
- [def settled(comments, now=None, quiet_minutes=90):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L150)
- [def content(repo, path, ref=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L165)
- [def repo_context(repo):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L178)
- [def cached(key, fetch):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L197)
- [def discover_models(api_key):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L207)
- [def fetch_gemini_models(api_key):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L212)
- [def full_catalog(pid):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L253)
- [def select_models(available):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L260)
- [def provider_headers(p):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L273)
- [def provider_models(pid):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L278)
- [def list_provider_models(pid, p):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L293)
- [def code_providers(private=False):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L317)
- [def coding_output_ceiling():](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L338)
- [class TaskTimeExpired(Exception):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L348)
- [def model_timeout(limit=120):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L352)
- [def fits(p, prompt, max_output_tokens):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L361)
- [def provider_identity(pid, key=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L371)
- [def health_store():](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L400)
- [def health_record(route):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L406)
- [def health_save(route, record):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L414)
- [def provider_failure(pid, model='', code=None, error=None, key=None, headers=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L424)
- [def provider_denied(pid, model, code, key=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L442)
- [def provider_paused(identity, model='', probe=False):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L446)
- [def provider_success(pid, model='', key=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L464)
- [def routes_unavailable(errors):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L474)
- [def run_fallback_providers(prompt, max_output_tokens, errors, allowed=None, tier=None, skip=(), json_mode=False):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L491)
- [class PremiumNotUsed(RuntimeError):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L607)
- [def premium_used(info):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L617)
- [def _router_post(path, payload, timeout=30):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L625)
- [def report_route_quality(call, usable):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L646)
- [def premium_outcome(task, step, outcome):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L658)
- [def asking(name):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L663)
- [def rate_limited(model, exc):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L678)
- [def run_model(api_key, prompt, max_output_tokens=2000, allowed=None, json_mode=False, skip=()):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L694)
- [def run_integrated_router(prompt, max_output_tokens=2000, allowed=None, json_mode=False, skip=()):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L727)
- [def _run_model(api_key, prompt, max_output_tokens=2000, allowed=None, json_mode=False, skip=()):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L892)
- [def ask_gemini(api_key, model, prompt, max_output_tokens, json_mode, errors):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L933)
- [def report_failure(number, token, reason, next_step):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L993)
- [def inference_backend_ready():](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L1007)
- [def main():](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runner.py#L1015)

## engine/developer.py

- [def _add_engine_developer_source(sources, existing, repo, sha, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L55)
- [def check_path(path):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L90)
- [def target_of(issue):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L100)
- [def token_for(repo, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L107)
- [def run_sandbox_repair(repo, sha, repo_token, changes, task, api_key, allowed, base_sources=None, context=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L112)
- [def report_sandbox_failure(number, result, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L160)
- [def repair_history(result):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L175)
- [def publish_candidate(repo, parent, changes, modes, message, writer, branch, create=False, base=''):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L185)
- [def publication_finished(journal):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L232)
- [def verify_publication(pr, repo, branch, sha):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L247)
- [def publication_metadata(journal):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L254)
- [def gh(path, token, payload=None, method=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L271)
- [def task_base(issue):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L278)
- [def snapshot(repo, token, base=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L294)
- [def is_private(repo, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L307)
- [def list_tree(repo, sha, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L315)
- [def read_source(repo, path, sha, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L326)
- [def tests_required(existing):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L333)
- [def read_target(repo, path, sha, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L340)
- [def parse_json(text):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L352)
- [def project_guidance_report(repo, sha, existing, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L363)
- [def project_guide(repo, sha, existing, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L387)
- [def compact_project_guidance(guide, task, paths=(), limit=4200):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L399)
- [def test_workflow(repo, branch, sha):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L483)
- [def dispatch_tests(repo, branch, sha, token, paths=()):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L491)
- [def request_review(repo, branch, sha, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L512)
- [def worker_sources(stage, sources):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L529)
- [class Stage(str):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L543)
- [def review_stage(api_key, task, stage, changes, before, allowed=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L554)
- [def waves(stages):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L575)
- [def has_tests(files):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L604)
- [def needs_test(changes):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L608)
- [def download_repository(repo, sha, files, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L612)
- [def build_repo_map(repo, sha, files, token, sources=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L623)
- [def plan_update(progress, method, reason, trigger, *entries, **changes):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L634)
- [def research_notes(progress, researcher, needed):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L639)
- [def classify_task(progress, journal, repo, request):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L662)
- [def start_plan(progress, journal, repo, sha, task, issue, design, sources, stages, questions, require_test, repo_map=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L683)
- [def exploration_repository(repo, sha, existing, token, archive):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L708)
- [def plan_change(api_key, task, files, guide="", allowed=None, limit=LARGE.read_files, repo_map=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L720)
- [def select_files(api_key, task, files, guide="", allowed=None, limit=LARGE.read_files, with_stages=False, repo_map=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L744)
- [def apply_changes(sources, existing, proposal, budget=SMALL):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L835)
- [def syntax_error(path, text):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L886)
- [def module_name(path):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L931)
- [def top_level_imports(path, text, exists):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L935)
- [def import_cycle(changes, read, limit=60):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L961)
- [def named_definitions(text, task):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L996)
- [def excerpt(text, task, budget=MAX_FILE_CHARS, lines_near=()):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1022)
- [def web_copy_path(repo, path):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1113)
- [def redirect_ios_copies(repo, proposal):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1118)
- [def mirror_ios_copies(repo, changes, existing):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1135)
- [def repair_budget(budget):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1158)
- [def generate(api_key, task, repo, sources, existing, guide="", allowed=None, design="", require_test=False, allow_empty=False):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1163)
- [def closest_text(message, sources, context=3):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1256)
- [def diagnose_generation_failure(message, sources):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1273)
- [def repair_evidence(exc):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1317)
- [def source_priorities(sources, existing, task, journal=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1357)
- [def generate_with(api_key, task, repo, sources, existing, guide, allowed, budget, design="", require_test=False, allow_empty=False](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1373)
- [def flagged_changes(sources, changes):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1780)
- [def workflow_flags(sources, changes):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1802)
- [def workflow_notice(sources, changes):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1820)
- [def change_flags(repo, sources, changes, body):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1830)
- [def push_token(repo, token, paths):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1838)
- [def move_branch(repo, token, branch, sha, create=False):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1850)
- [def flags_allowed(body):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1867)
- [def stop_for_flags(repo, number, flags, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1871)
- [def commit_changes(repo, parent, changes, modes, message, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1881)
- [def took(seconds):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1890)
- [def feed_fields(say=False, tool="", detail="", output="", added=None, removed=None, count=None, status=""):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1909)
- [def line_delta(before, after):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1925)
- [def note_changes(model, changes, sources, existing):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1937)
- [def activity_kind(text):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1965)
- [def note(kind, text, **feed):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1970)
- [def _asking(model):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L1983)
- [def _money(info, key):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L2002)
- [def _premium(info):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L2007)
- [def premium_possible(step):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L2044)
- [def premium_rescue_step(step, reason, attempt):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L2049)
- [def premium_outcome(step, outcome):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L2075)
- [class Progress:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L2083)
- [def _serialized(method):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L2276)
- [def note_progress(journal, **changes):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L2287)
- [def short_list(paths, n=4):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L2293)
- [def build_in_stages(api_key, task, repo, sources, existing, guide, allowed, stages, progress=None, design="", require_test=False, ](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L2302)
- [class _QuietReviewProgress:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L2533)
- [def check_the_work(api_key, task, repo, sha, repo_token, sources, existing, changes, guide, allowed, design, require_test, progres](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L2545)
- [def review_sandbox_candidate(api_key, task, repo, sha, token, sources, changes, body, allowed, progress,](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L2822)
- [def produce_development_pr(issue, api_key, token, adopt=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L2850)
- [def plan_layout(issue, stages):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3189)
- [def plan_status(code=False, checked=False):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3200)
- [def open_plan_draft(repo, token, number, issue, base, sha, branch, layout, design=""):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3210)
- [def review_body(number, model, explanation, summary, changes, design="", problems=(), layout=""):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3241)
- [def job_log(job_id, token, limit=7000):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3255)
- [def failure_excerpt(text, limit):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3281)
- [def base_test_regressions(log, repo, base_sha, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3300)
- [def working_source(path, sources, existing, journal):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3349)
- [def files_named_in(log, existing, changed):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3362)
- [def repair_branch_observation(repo, pr, candidate, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3372)
- [def revision_focus(pr, log, existing, changed):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3388)
- [def verified_source_lines(findings, sources):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3401)
- [def anchor_pr_goal(goal, pr, repo, token, head):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3420)
- [def revision_files(pr, repo, head_sha, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3432)
- [def revise_branch(issue, pr, branch, head_sha, failed_jobs, token, api_key, repo=ROOT, repo_token=None, guidance=(), native_histor](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3476)
- [def verified_history(design, tried, notes, native_history, diff, limit=VERIFIED_HISTORY_CHARS):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3672)
- [def retry_now(error, journal, repair_round):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3695)
- [def fix_label(cycle, limit):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3705)
- [def question_replies(number, token, journal, repo, request):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3710)
- [def owner_guidance(number, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3720)
- [def failure_summary(failed, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3731)
- [def sandbox_result(branch, head_sha, token, repo=ROOT):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3738)
- [def report_stuck(repo, number, pr, fixes, failed, token, repo_token, comments):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3752)
- [def fix_pull_request(issue, api_key, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/developer.py#L3771)

## engine/tool_loop.py

- [def _bounded_result(result):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/tool_loop.py#L43)
- [def _kind(value):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/tool_loop.py#L108)
- [def parse_reply(raw):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/tool_loop.py#L114)
- [def run_tool_loop(run_model, api_key, task, tools, max_steps=20, allowed=None, on_call=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/tool_loop.py#L134)

## engine/sandbox_repair_controller.py

- [def _fingerprint(value):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox_repair_controller.py#L15)
- [def _failure_key(results):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox_repair_controller.py#L19)
- [class SandboxRepairController:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox_repair_controller.py#L35)

## engine/sandbox_tools.py

- [def patch_read_hint(path, find, source):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox_tools.py#L7)
- [class SandboxTools:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox_tools.py#L16)

## engine/sandbox.py

- [class SandboxUnavailable(RuntimeError):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L41)
- [class CommandRejected(ValueError):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L47)
- [class Profile:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L52)
- [def now():](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L71)
- [def redact(text):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L75)
- [def safe_path(path):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L90)
- [class RunResult:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L98)
- [class _Bounded:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L123)
- [class Exec:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L149)
- [class Docker:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L157)
- [class Tree:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L230)
- [def fetch_revision(repo, sha, token, opener=urllib.request.urlopen):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L269)
- [class Toolchain:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L286)
- [class Python(Toolchain):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L304)
- [class Node(Toolchain):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L350)
- [class Policy:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L401)
- [def kappa_test_command(tree):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L426)
- [def image_versions(tree):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L433)
- [class Session:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L456)
- [def open_session(repo, sha, token, opener=urllib.request.urlopen, docker=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/sandbox.py#L767)

## engine/exploration.py

- [def scoped(function):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/exploration.py#L29)
- [class _DeadlineExceeded(Exception):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/exploration.py#L47)
- [def _escaped(pattern, index):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/exploration.py#L51)
- [def _group_start(pattern, close):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/exploration.py#L59)
- [def _regex_uses_unsafe_backtracking(pattern):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/exploration.py#L81)
- [def _regex_search(pattern, files, timeout, limit=2000):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/exploration.py#L129)
- [class Budget:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/exploration.py#L147)
- [class Repository:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/exploration.py#L168)
- [def _page(items, page, size=PAGE):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/exploration.py#L211)
- [class Explorer:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/exploration.py#L217)
- [def leads(text, limit=4):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/exploration.py#L477)
- [def traceback_files(text, files, limit=3):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/exploration.py#L490)
- [def module_paths(module, files):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/exploration.py#L503)
- [def investigate(run_model, api_key, task, repository, sources, questions, allowed=None, budget=None, report=None,](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/exploration.py#L514)

## engine/research.py

- [def config():](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/research.py#L45)
- [def now_iso(clock=time.time):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/research.py#L50)
- [class _Text(HTMLParser):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/research.py#L54)
- [def page_text(body, content_type):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/research.py#L92)
- [def version_key(version):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/research.py#L101)
- [def file_version(filename, name):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/research.py#L112)
- [class NoRedirect(urllib.request.HTTPRedirectHandler):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/research.py#L122)
- [def default_opener(request, timeout):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/research.py#L127)
- [class Research:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/research.py#L131)
- [def scoped(function):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/research.py#L542)

## engine/requirements.py

- [def process_line(text):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L67)
- [def paragraph_kind(request, start):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L77)
- [def canonical_text(text, originals):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L100)
- [class Requirement:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L108)
- [def split(request):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L125)
- [def authority_ask(text):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L155)
- [def negated_action(text, position):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L163)
- [def rule_categories(text):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L179)
- [def validate(items, request, scope=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L203)
- [def classification_prompt(rows):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L263)
- [def parse_classification(answers, rows):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L276)
- [def classify(request, answers=None, scope=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L294)
- [def schema():](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L308)
- [def test_evidence(entry, read):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L315)
- [def matrix(classified, reviewed, read):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L327)
- [def open_items(rows):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L354)
- [def render(rows, sandbox_passed=False):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L362)
- [def review_instructions(classified):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L380)
- [def save(journal, classified, repo, task):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L391)
- [def load(journal, repo, task, scope=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L408)
- [def scoped(function):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/requirements.py#L451)

## engine/verify.py

- [def added_lines(old, new):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L42)
- [def changed_position(old, new, position):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L47)
- [def repeated_body_read(old, new):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L52)
- [def parse_quietly(text):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L60)
- [def imports_repository_module(path, text, source_paths):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L70)
- [def reads_repository_file(text, file_paths):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L110)
- [def tests_without_real_code(changes, all_paths=()):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L127)
- [def stand_in_problems(read, changes, all_paths):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L154)
- [def worker_problems(sources, changes):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L223)
- [def test_binding_problems(read, changes, all_paths):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L253)
- [def resolve_module(path, target, known):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L294)
- [def module_binds(path, name, owners, read, changes, known, seen=None, expected=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L302)
- [def preference_problems(read, changes):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L331)
- [def unused_problems(read, changes, all_paths):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L350)
- [def exported(name, text):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L371)
- [def misuse_problems(changes):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L376)
- [def removed_problems(read, changes, task=""):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L389)
- [def wiring_problems(repo, root, read, sources, changes, all_paths, task=""):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L420)
- [def diff_text(read, changes, limit=40000):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L429)
- [def review_sources(read, changes, paths, requested=(), limit=220000, complete=None, balance=False,](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L437)
- [def report_ask(text):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L529)
- [def lifecycle_requirement(text):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L542)
- [def pr_receipt(pr, repo, branch):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L561)
- [def resolve_lifecycle(reqs, receipt):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L573)
- [def controller_requirement(text):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L591)
- [def resolve_controller(reqs, changes=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L596)
- [def controller_problem(problem, resolved=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L627)
- [def stale_untested(problem):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L670)
- [def process_problem(problem):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L685)
- [def lifecycle_problem(problem):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L690)
- [def inventory_sources(task, changes, paths):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L697)
- [def inventory_evidence_problems(links, checks, read, changes, known, context):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L726)
- [def requirement_references(task, texts):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L758)
- [def review_inventory(paths, task, limit=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L789)
- [def review_prompt(task, diff, paths, context='', inventory_limit=None, classified=(), scope_paths=(), scope_lines=False, citations](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L805)
- [def source_citation_catalog(line_context, clues='', preferred=()):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L887)
- [def resolve_review_lines(raw, line_context, classified=(), citations=()):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L916)
- [def parse_review(output):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L954)
- [def superseded_review_problem(problem, reviewed, rows=()):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L990)
- [def executable_evidence(path, source, quote):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L1022)
- [class ScopeReviewUnavailable(ValueError):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L1053)
- [class RequirementReviewUnavailable(ValueError):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L1057)
- [def scope_batches(run_model, api_key, task, changes, goal, allowed, pinned=False):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L1064)
- [def model_review(run_model, api_key, task, read, changes, paths, allowed=None, classified=None, retained_requirements=()):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L1144)
- [def report(reqs, problems):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L1400)
- [def review_record(problems):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L1429)
- [def open_problems(pr):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/verify.py#L1434)

## engine/recovery.py

- [def _time(value):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/recovery.py#L40)
- [def notify_wake(task):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/recovery.py#L51)
- [def clean(value, size=700):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/recovery.py#L79)
- [def diagnose(error):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/recovery.py#L85)
- [def comments(read, number):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/recovery.py#L151)
- [class Journal:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/recovery.py#L161)
- [def verify_saved_candidate(journal, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/recovery.py#L848)
- [def resume_checks(journal, pr, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/recovery.py#L868)
- [def scan(read, write, clock=time.time, task=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/recovery.py#L915)
- [def main():](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/recovery.py#L981)

## engine/execution.py

- [class CheckpointMismatch(PermissionError):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L24)
- [class CheckpointUnavailable(RuntimeError):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L28)
- [def clean(value, limit=4000):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L32)
- [def task_digest(task):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L39)
- [def sanitized(value):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L46)
- [def digest(value):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L56)
- [def tree_digest(tree):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L60)
- [def patch(session):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L65)
- [def revision(session):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L69)
- [def _read_blob(journal, receipt):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L73)
- [def _write_blob(journal, value, previous=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L105)
- [def _reusable(number):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L131)
- [def pending(journal, kind=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L140)
- [def supersede_reviewed_proposal(journal, head):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L165)
- [def seed(journal, repo, sha, changes, task, context=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L185)
- [def initial_data(identity, task, state, journal, context):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L210)
- [def generation_plan(journal, repo, task):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L220)
- [def refresh_unpublished_main(journal):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L251)
- [def save_plan(journal, repo, sha, task, context, sources):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L320)
- [def require_storage(journal, repo):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L333)
- [class Execution:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L342)
- [def sandbox_tools_counts(session, result):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/execution.py#L511)

## engine/runtime_engine.py

- [def trial_pr(receipt, scope, read, current=False):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runtime_engine.py#L14)
- [class EngineRefreshRequired(RuntimeError):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runtime_engine.py#L31)
- [def verify_receipt(receipt, scope, read):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runtime_engine.py#L35)
- [def renew_receipt(receipt, scope, read):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runtime_engine.py#L61)
- [def attest(scope, read, previous=None, env=None, checkout=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runtime_engine.py#L72)
- [def permits(ref, scope=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/runtime_engine.py#L159)

## engine/task_state.py

- [def clean(value, size=220):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L25)
- [class Record:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L31)
- [class StatePrompt(str):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L47)
- [class CandidateChanged(ValueError):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L55)
- [def current():](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L59)
- [def begin_effort(limit):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L65)
- [def small_document_repair(paths, request):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L74)
- [def charge_effort():](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L92)
- [def digest(goal):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L104)
- [def inference_key():](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L111)
- [class InferenceCall:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L125)
- [def inference(prompt, engine):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L163)
- [def inference_attempt(prompt, route):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L177)
- [def require_journal_identity(journal):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L185)
- [def bind(repo, task, branch, candidate, journal=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L194)
- [def checkpoint(candidate, files=()):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L240)
- [def observe_pr(pr, repo, branch):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L259)
- [def observe_validation(kind, candidate, run):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L276)
- [def failure(error, model=''):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L292)
- [def provider_usage(route, usage=None, failed=False):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L302)
- [def review(requirements, problems):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L332)
- [def plan(stages):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L342)
- [def stage(index, total, description):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L351)
- [def stage_result(index, accepted):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L359)
- [def action(role, operation, reason, success):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L369)
- [def role(name, operation, success, routing_role=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L382)
- [def before_edit(changes):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L410)
- [def snapshot(journal=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L423)
- [def save(journal):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L461)
- [def add_to_prompt(prompt, journal=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L473)
- [def wire(data):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L548)
- [def render(data, text, max_context=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L552)
- [def decode_prompt(prompt):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/task_state.py#L595)

## engine/budget_ledger.py

- [class Ledger:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/budget_ledger.py#L16)

## engine/project_memory.py

- [def snapshot(report):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/project_memory.py#L12)
- [def extract_latest(comments,repo):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/project_memory.py#L31)
- [def change_summary(previous,current):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/project_memory.py#L44)
- [def recent_repo_memory(repo, github, token, current_issue=None, max_issues=12):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/project_memory.py#L52)

## engine/export_index.py

- [def names(path, text):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/export_index.py#L16)
- [def render(sources, order, cap=1500):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/export_index.py#L29)

## engine/intent_guard.py

- [def test_dispatch(path, payload, scope):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/intent_guard.py#L30)
- [def timestamp(value):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/intent_guard.py#L44)
- [class ExecutionScope:](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/intent_guard.py#L51)
- [def activate(issue):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/intent_guard.py#L226)
- [def guard_request(url, payload, method, read_current):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/intent_guard.py#L233)
- [def report_state(scope, body):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/intent_guard.py#L247)
- [def report_provenance(url, payload):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/intent_guard.py#L255)
- [def record_success(url, payload, result=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/engine/intent_guard.py#L263)

## scripts/task_intake.py

- [def request(path, token, payload=None):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/scripts/task_intake.py#L18)
- [def eligible(issue, action, label_name=""):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/scripts/task_intake.py#L34)
- [def already_dispatched(issue_number, created_at, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/scripts/task_intake.py#L55)
- [def dispatch(issue, token):](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/scripts/task_intake.py#L70)
- [def main():](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/scripts/task_intake.py#L95)

## chat-backend/src/index.js

- [export class KappaMemory {](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/index.js#L39)

## chat-backend/src/inference-router.js

- [export async function inferenceRouter(env,input,callerSignal=null,{paidRescue=false}={}){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/inference-router.js#L76)

## chat-backend/src/providers.js

- [export function configured(env,id){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/providers.js#L23)
- [export function providerDiscoveryDiagnostic(env,id){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/providers.js#L42)
- [export async function providerModels(env,id){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/providers.js#L55)
- [export async function providerSummary(env,health={}){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/providers.js#L130)
- [export async function fallbackRoutes(env,geminiModels,prefs={},hasMedia=false,options={}){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/providers.js#L145)
- [export function toChat(payload){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/providers.js#L226)
- [export async function callProvider(env,route,chat,streaming,signal){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/providers.js#L240)
- [export function stripThinking(text){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/providers.js#L270)
- [export function thinkingFilter(){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/providers.js#L277)
- [export class ProviderResponseError extends Error {](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/providers.js#L299)
- [export function validateProviderResponse(data,{stream=false,workers=false,gemini=false}={}){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/providers.js#L303)
- [export function normalizeResult(route,data){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/providers.js#L330)
- [export function chunkNormalizer(route){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/providers.js#L344)
- [export function codingRequestBudget(input,provider,route,defaults){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/providers.js#L356)

## chat-backend/src/routing-policy.js

- [export function requestRoutingPreferences(text,preferences={}){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/routing-policy.js#L8)
- [export function everyFreeModel(env,id){const all=list(env.KAPPA_ALL_MODEL_PROVIDERS);return (all.has("*")||all.has(id))&&registry.](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/routing-policy.js#L21)
- [export function fullCatalog(env,id){if(id==="openrouter")return false;const all=list(env.KAPPA_ALL_MODEL_PROVIDERS);return all.has](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/routing-policy.js#L24)
- [export function providerPolicyStatus(env,channel,id,{privateCode=false,requested=null}={}){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/routing-policy.js#L28)
- [export function providerAllowed(env,channel,id,options={}){return providerPolicyStatus(env,channel,id,options).enabled;}](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/routing-policy.js#L46)
- [export function routePolicy(env){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/routing-policy.js#L48)

## chat-backend/src/premium.js

- [export function maxCharge(pricing,promptTokens,maxTokens,margin=premiumConfig()?.safetyMargin||1.25){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/premium.js#L51)
- [export function premiumSelection(models,{promptTokens,maxTokens,budgetUsd,health={}},config=premiumConfig()){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/premium.js#L57)
- [export function selectionExplanation(pick,skipped,config=premiumConfig()){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/premium.js#L83)
- [export async function premiumCatalog(now=Date.now(),fetcher=fetch){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/premium.js#L89)
- [export async function premiumOp(env,body){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/premium.js#L101)
- [export function premiumAvailable(env,requested){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/premium.js#L113)
- [export async function premiumRescue(env,{task,step,reason,quote,requestId,system,messages,promptChars,maxTokens,temperature,signal](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/premium.js#L119)

## chat-backend/src/operation-contract.js

- [export function operationContract(env){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/operation-contract.js#L3)
- [export function checkOperationContract(env,input,{required=false}={}){](https://github.com/onlykappa/KappaForge/blob/19c95923d12156688487fd8d4e1f6dd1c16eefa6/chat-backend/src/operation-contract.js#L10)

## preview/app-state.js


## preview/app-tasks.js


## .github/workflows/agent.yml


## .github/workflows/task-intake.yml


## .github/workflows/tests.yml


## .github/workflows/deploy-chat.yml


## config/providers.json


## config/research-hosts.json


## chat-backend/wrangler.toml

