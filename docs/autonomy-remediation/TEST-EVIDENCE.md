# Test evidence — checkpoint, 2026-10-31

This is an incomplete remediation checkpoint. A passing suite certifies its stated checks on its candidate; it is not a general autonomy benchmark. Original score baselines remain autonomy42, reliability38 and readiness35. No merge, deployment, release or paid inference occurred.

## Current independently retrieved CI

| Candidate | Result | Reproducible evidence |
|---|---|---|
| Foundation `38aca4d7bcdf3b294ea43f40b8ec9d005f462542` (#333) | Unit, structure, browser, Worker, actual Docker and native simulator/build passed. Release skipped. | [Tests41136935835](https://github.com/onlykappa/KappaForge/actions/runs/41136935835), [sandbox41136935837](https://github.com/onlykappa/KappaForge/actions/runs/41136935837), [native41136935766](https://github.com/onlykappa/KappaForge/actions/runs/41136935766) |
| Versioned tools `a62f9493197a1811aa52aa27967e999ee894cbb1` (#334) | Unit1484, OK(skip34); Node924 passed; browser, Worker and real sandbox passed. | [Tests41137357103](https://github.com/onlykappa/KappaForge/actions/runs/41137357103), [sandbox41137357086](https://github.com/onlykappa/KappaForge/actions/runs/41137357086) |
| Lifecycle `125a0991ed69b40ef604fa10626cbf2cdce745f2` (#335) | Unit/web/structure/Worker and real sandbox passed. **Native failed:**5 tests,4 passed,1 failed,0 skipped. Simulator and unsigned iPhone builds succeeded; release skipped. | [Tests41141346461](https://github.com/onlykappa/KappaForge/actions/runs/41141346461), [sandbox41141346456](https://github.com/onlykappa/KappaForge/actions/runs/41141346456), [failed native41141346449](https://github.com/onlykappa/KappaForge/actions/runs/41141346449) |
| Diagnostics `c3d6606aabd54d9886f1cbac3025df9c93ca52ce` (#336) | Python1495, OK(skip34):1461 passed. Node929 passed, zero failures/skips. Browser, structure, Worker dry build and isolated runtime recovery passed. Native/sandbox workflows did not trigger for this incremental file set; this does not erase the inherited native failure. | [Tests41141422656](https://github.com/onlykappa/KappaForge/actions/runs/41141422656) |

Machine receipts: [initial CI](evidence/ci-receipts.json), [latest CI/job conclusions](evidence/ci-2026-10-31.json), [latest actual test-count excerpts](evidence/latest-test-excerpts.json). Do not add repeated overlapping suite totals to manufacture a benchmark denominator.

Real Docker run41141346456/job124356078435 executed25 sandbox tests,2 repair integrations,18 Phase1 acceptance tests,8 Phase2 and2 Phase3 tests. Secrets/network/system-file denial, timeout/memory/output limits, provider outage resume and controlled source-bound browser demonstration ran. Full project tests also ran inside isolation: Python1495 OK(skip39), Node925 passed. These are controlled/scripted-provider fixtures; they are not live LLM task-completion evidence. Phase1/2/3 in existing test names refer to older product fixtures, not completion of remediation phases A–H.

Native failure evidence: [count receipt](evidence/native-failed-receipt.json), [accessibility hierarchy](evidence/native-failed-hierarchy.txt). `native-composer` exists and has keyboard focus but reports `(inf, inf, 0, 0)` with an offscreen/null accessibility frame. One test caused two assertion failures; do not misreport that as two failed tests. Root cause is under investigation. Earlier native success does not override this newer failure. Physical-device evidence remains unmeasured.

Downloaded artifact hashes independently matched GitHub metadata:

- Native count artifact13019781699: `c0a13875b4522e86c03f6dabe6501e822b67724976621f208a7311132a08ae82`.
- Native screenshot artifact13020221312: `f9e4f17b3a11788e155117151c92b54fd8cb326578eaba37e01e5a9db7258303`.

## Local execution and independent negative controls

The unchanged audit baseline19c9592 ran Python1452 OK(skip36), Node924 passed. Lifecycle125a099 ran Python1495 OK(skip36) in96.802s. Earlier Node on09de1b4 passed925; the subsequent125a099 change moved Python authority probes only. Diagnostics c3d6606 ran Node929 passed in28.134s, targeted diagnostics/Premium43 passed, Worker dry build and actual isolated workerd/SQLite restart/alarm recovery passed (`production:false`, `inference:false`). Current supported CI independently confirms these candidates.

Regressions cover full40-requirement overflow, long wording, sparse budget restart and invalid inputs, exact Task330 diff scope and authorization evidence, owner command receipts, closed drafts before inference, blocked-after-green UI and stopped timers, versioned atomic patches, truncated/fenced/singleton output repair, and explicit invalid-output Fix without lifetime budget reset.

Independent controls actually executed:

- Original PR323 copied-helper change replayed at basefaf250e310ad9afe0e6e640c5b6bd4c6d59c0c87/head534633c2a1db73bc7616015fcd3848770af9effc. The scoped binding verifier rejects copied `isAnswered`; an import in a different callback cannot certify it. Real Node fails a constant-true mutation of production and passes the correct imported implementation.
- Real-Ledger invalid-input test passes. A runtime-only mutation admitting non-string keys makes exactly the key123 subtest fail. No product file was mutated.
- Controlled wrong-export repair executes real Node assertions, first failing then passing candidate and fresh regression, while preserving product source/assertions and exactly one changed test file. Transport/provider are scripted; Docker proof comes from separate supported CI.

Historical failures were preserved in the execution record: original foundational regressions were red on baseline; standalone641a7e9 CI failed stale dependency-map freshness and was corrected on38aca4d; lifecycle09de1b4 initially failed the no-privileged-API verifier invariant and was corrected by moving read-only probes into the authority service, then the full suite passed. Native failure remains unresolved. No failure was converted to a skip to obtain success.

## Evidence limitations and retention

The managed environment replacement on October31 preserved `/workspace` but cleared old `/tmp/remediation-*.log` files before they were copied. Historical local totals above were observed in tool output; raw local logs are unavailable. Fresh GitHub job logs/counts were retrieved independently and saved here. Future runs must write directly into this durable evidence directory or preserve sanitized excerpts immediately; do not create invented log hashes.

Local Docker is installed, but the existing product admission requires a real public GitHub-hosted Linux run; local integration attempts correctly failed admission. No `GITHUB_ACTIONS` spoofing or host execution fallback was used. Local WebKit launch lacked GTK4/Graphene/Harfbuzz-ICU/Manette/Hyphen/GLES libraries; supported CI Chromium/WebKit succeeded. Xcode and physical iPhone are not locally available.

No normal-intake live model replay, NVIDIA canary, held-out50-task benchmark, actual deployed provider/Premium snapshot or30-day production SLO evaluation has run. Their acceptance gates remain open. A fresh independent autonomy score must wait for new functional evidence.

## Subsequent candidate results — October31

- Required integration0bba923 (#338): local Python1500 OK(skip36). Actual supported run41203292992 passed all five strict gates,55 tests total and zero skips. Required groups:6 actual Docker,2 repair,12 real Phase1,1 real Phase2 and1 real Phase3 tests. Downloaded [artifact metadata](evidence/required-positive/artifact-metadata.json) and all five JSON receipts are durable. Expected local negative: unittest25 total/19 pass/6 required skip reportsOK but gate correctly exits1; see local-required-sandbox-negative.json/log. KF-AUDIT-048 is verified for these mandatory gates.
- Native host64a9ac3 (#339): actual run41203455958 passed5/5 unchanged UI tests with zero skips; simulator and unsigned builds passed, release skipped. [Independent count receipt](evidence/native-host-positive/kappaforge-native-evidence.json) and artifact SHA metadata retained. Local14 Node and11 Python contracts also passed. The preceding unmodified native code also passed on0bba923, confirming intermittency; one candidate pass does not establish physical-device closure or elimination of every race.043 remains partial.
- Rejected edit memoryd526ddd (#340):87 focused tests plus6 journal/real-Node tests passed; full Python1505 OK(skip36). CI tests41203985793 and strict sandbox41203985916 passed. A different replacement/unrelated file cannot repeat the same failed anchor; actual source/same-file-prefix changes can. Lifetime budgets and prior failures survive journal restore. Initial-generation rejection protocol is not consolidated by this change.
- Repair historybc04800 (#341):28 focused history/tool/strategy/restart tests passed; full Python1509 OK(skip36). Exact history exceeding30k is reconstructed after checkpoint/restart through actual tool results with matching SHA, without full records in each prompt. This proves the repair-plan retrieval slice, not general semantic context memory or complete generation-event archive rotation. Latest supported CI is still being collected.

Full local logs and targeted regressions after restart now write into this directory's evidence/ rather than ephemeral /tmp. The initial history fixture was27,892 characters and correctly failed the >30k assertion; increased the fixture to16 retained plans while preserving the acceptance threshold, then the test passed. No gate assertion was relaxed.

Latest exact-code CI bc048002adbe799e47f0ac68638257f1d5af417f is now complete: tests41204467206 passed unit/browser/Worker/structure; Python1509 total,1475 passed,34 skipped,0 errors/failures; Node929 passed,0 failed. Strict real sandbox41204467210 passed all required gates; project-inside-sandbox Python1509 OK(skip39), Node929 passed. [Durable job/count receipt](evidence/ci-bc04800.json). This updates the pending status above; broad live benchmark and open gap acceptance are still unmeasured.

## Device-session backend foundation — October31

`remediation/a-device-sessions` composes the #343 free-cost boundary. Python1512 total/1478 pass/34 skips, zero failures/errors in102.736s; Node945 pass/zero failures/skips. The twelve new gateway/store tests and actual workerd/SQLite persistent revocation check passed. Existing automatic recovery runtime, Worker dry build, web/map/execution-policy checks, ten structural-rule tests and structural scan also passed (existing HTML warnings retained). [Machine evidence and durable raw-log hashes](evidence/device-sessions-local.json). This remains partial037: native/browser credentials have not migrated, no production auth policy changed, and no live-model/50-task benchmark executed.

The free-cost candidate #343 at1ff8f7a also passed actual secret-free manual sandbox run[41207259155](https://github.com/onlykappa/KappaForge/actions/runs/41207259155). Its automatic tests41206904310 and review graph41206904332 passed. These are isolated developer checks, not production/model evidence.

Owner sequencing preference: batch coherent related fixes with focused regression checks during implementation; run broad suites on composed phase candidates. Keep mandatory security checks before publication. Large held-out autonomy evaluation follows foundational implementation, independently graded. Do not rerun a full suite after every small edit or confuse targeted coverage with phase acceptance.

## Central authenticated client transport — focused patch-batch evidence

New client transport10 tests passed;135 affected chat/task/weather/location/voice/sync/dashboard/diagnostic tests passed, zero skips/failures. Initial135-test run had121 passes/14 failures from component harnesses not loading the new transport; the exact failure log is retained. Harnesses now use the actual production transport and their existing network fakes; assertions unchanged. Actual client transport → workerd/SQLite enrollment/use/restart/revocation passed; no external traffic and no silent replay after401. Web bundle/syntax, map, execution-policy and structural scan passed. No full local suite was repeated for this incremental patch; composed CI will supply the broader candidate gate.

Backend3ddb7f4/#344 now has successful actual tests[41228025480](https://github.com/onlykappa/KappaForge/actions/runs/41228025480): unit, Worker including real persistent sessions, web and structure all success. Review graph41228025482 succeeded. This validates the stated checks, not complete037 or live autonomy.

Transport7699d41 composed CI41228661053 found four failed Node executions (955 total,951 passed), all classic-script harnesses missing the new dependency: native Retry fixture twice through existing imports, and two request-routing cases. Unit, actual Worker and structural jobs passed; browser launch was skipped after Node failure. The full failed log is retained. The remaining harnesses now use the real transport; the Debug-simulator-only recovery fixture supplies a synthetic short session, so it cannot accidentally renew a real native credential. All62 focused CI-regression tests passed. This correction preserves original receipt/no-duplicate-dispatch/rollout assertions. Native and broad revised-candidate checks remain required; old green checks do not certify this change.

Revised composed transport local Node955 passed,0 failures/skips in21.999s, including the previously failing native Retry and uncertain-receipt/paused-routing cases. The Debug-simulator fixture now uses a synthetic short-lived device session through the actual transport, with every nonfixture network destination denied. Mandatory revised-candidate CI/native checks remain pending.

## Native device authentication candidate — focused implementation batch

Native candidate local Node962 passed, zero failures/skips in22.174s;48 focused sessions/transport/native-contract tests passed. Five new JavaScript tests execute the actual Swift bootstrap and confirm public-only metadata, enrolled storage cleanup, disconnected no-fallback, correlated/bounded/error-redacted renewal and native secure connection dispatch. A first test attempted to stringify a self-referential browser window; replaced that invalid test reader with an injected script reading the relevant credential surfaces, retaining secret-absence assertions. No product behavior was changed to satisfy that fixture error.

Two new gateway regressions verify renewal-authenticated self-disconnect and explicit owner re-enrollment with old-secret denial. Native implementation adds five Swift session tests and one native UI test; **not executed locally** (no Swift/Xcode). Actual macOS CI/build/test gates are mandatory and pending. The original five UI tests are retained. Config freshness initially rejected the new SessionTests bundle identifier: configure.py now preserves this test-target suffix instead of rewriting it to the app id. Freshness and web/map/execution-policy checks then passed; this is a generator extension, not a waived check.

This is partial037, not a completed migration. Unenrolled legacy browser storage, owner step-up controls, actual native test results, physical-device coverage and separately approved server rollout remain open. No production change, merge, release, paid call or broad live autonomy benchmark.

Actual isolated workerd/SQLite on the native candidate's server path passed production-client restart/revocation, owner re-enrollment rotating old secrets, and renewal-authenticated self-disconnect surviving another restart. Zero outbound requests. This check explicitly reports nativeRuntime:not_executed_by_this_check; it does not certify Swift execution. [Candidate local evidence](evidence/native-device-auth-local.json).

Native d84cebb actual CI41229597634 failed at XcodeGen before compilation: `bundle.unit-testing` is not a recognized target type. Corrected to `bundle.unit-test`; no native test pass is claimed. Revised transport835c0a3 CI41229300914 passed Node/unit/Worker/structure but browser verification timed out: its fixture seeded an HTTP backend, correctly rejected by the new production HTTPS policy. The fixture is being changed to an ephemeral real HTTPS loopback server so streaming/cancellation remain real; production policy is retained. Self-signed trust is isolated to the test browser context, never shipped. These failures remain recorded and block promotion until revised supported CI passes.

HTTPS browser-fixture correction executed locally with real desktop and mobile Chromium: both complete profiles passed, including real progressive streaming/cancellation, recovery crypto, task lifecycle/reload, owner restrictions and accessibility assertions. WebKit is not claimed locally; supported CI remains required. The local TLS key/certificate are ephemeral test-only files, removed at exit and not included in reports. Production HTTPS admission remains unchanged. Parent fixture fixfc6fdcf has been incorporated into the native candidate; only a local engineering dependency update occurred, no GitHub PR/main merge.

Native0c9f6f1 CI41229961934 advanced past project generation, then failed compilation: the new Swift raw multiline bootstrap string lacked its closing `#`. Corrected the delimiter; the JavaScript bootstrap extractor now requires the actual raw-string terminator. All9 bootstrap/native-fixture regressions passed. The protocol-conformance/brace diagnostics were cascades of this syntax error. Actual native compilation/unit/UI success remains unverified until the next supported run; local JavaScript execution alone is insufficient.

## Paged path discovery implementation batch

Five new deterministic regression tests plus existing exploration/tool/developer/repair checks:130 total,129 passed,1 real-Docker-dependent skip in4.543s. Actual investigation finds the target past path700 and derives/reads its import dependency from tool observations, downloads exactly two files, and retains unchanged configured context/call limits. Readless inventory pagination reaches path1000; unsafe arguments and restarted exhausted budgets fail closed. An initial test assumed the dataclass default40 calls; repository config is500. Corrected the test to require unchanged configured budgets, with the actual three-call discovery threshold retained. No product limit was increased.

This is controlled offline protocol evidence. Full composed Python/mandatory security/CI gates are being collected; no live-model benchmark, production deployment or overall014 closure claimed. Five-stage expansion/unified execution observations remain open. Details: PAGED-PATH-DISCOVERY.md.

Paged-path composed Python1517 total/1483 pass/34 skip,0 failures/errors in95.441s. Mandatory map/execution-policy/syntax and structural scan passed (existing HTML warnings). [Local receipt and durable log hashes](evidence/paged-path-discovery-local.json). Actual latest-native7207a55 tests41230157825 passed unit/Worker/web/structure; native simulator41230157892 is still in progress. Latest transportfc6fdcf tests41229904417 passed after the HTTPS fixture correction. Production/main remains19c9592, all PRs drafts, no merges/deployments/paid inference and no revised autonomy score.

## November6 resume: actual native result and correction

Fresh repository/PR reconciliation: main still19c9592, all remediation candidates remain drafts and owner work is unchanged. Paged discovery1af5f0b passed tests41230713358 and actual sandbox41230713354. Native7207a55 passed main tests41230157825 but failed native41230157892. Independently retrieved full job124622508990: all six UI tests passed, including secure connection/unsafe-origin denial; all five session-unit test bodies were blocked by setup/teardown Keychain `storage` errors. The workflow passed CODE_SIGNING_ALLOWED=NO into simulator build/test. These are not five successful Keychain tests, and the overall native gate is failed.

Correction candidate uses local ad-hoc signing only for simulator build/test and an SDK-conditional exact-app Keychain entitlement. No Apple account, production capability, device signing, owner permission, certificate purchase or release change. Actual Security.framework errors now retain numeric OSStatus for diagnosis; the page continues to receive generic errors without secrets. Tests still use the actual Keychain; none were converted to an in-memory substitute or skipped. Actual supported macOS rerun is required to verify the signing hypothesis.

Also found session migration denied read-only `/actions` and `/review`, preventing normal task monitoring/draft inspection. Admit those existing read handlers while continuing to deny `/actions/control`, `/decisions`, `/premium`, `/undo`, `/guidance` and their authorization grants. Focused execution:48 Node tests and33 Python workflow/security tests passed, zero skips/failures. Web/config/map/policy checks pass. No native pass, production functionality or whole037 closure claimed.

## November6 generation/recovery batch

Initial generation now shares the persisted source/prefix-bound rejection identity with sandbox repair, blocking deterministic anchor redispatch through changed replacements, unrelated edits, compact fallback and actual Journal restart/rotation. Seven new regressions plus existing suites:107 focused passed, no skips/failures. Composed Python1524 total/1490 passed/34 skipped in109.929s; Node279 passed, zero skips/failures. Ten structural-rule tests and scan passed (existing HTML warnings), dependency map and reviewed free-execution policy passed. See GENERATION-ANCHOR-RECOVERY.md. No live model or Task322 intake replay occurred.

The new tests initially referenced a nonexistent task_state context variable and omitted the legacy test import path; corrected the fixture setup/runner. A budget assertion initially expected no edit debit after a successful retry; strengthened it to seed historical4 edits/9 model calls, require exact preservation at restart and exactly one additional debit for the corrected retry. Product budget enforcement and all original behavioral assertions remain. Two old message assertions now expect bounded proposal attempts while retaining the exact five-call stop condition; no claim that repeated responses constitute different strategies.

## November6 bounded repair strategies

64 focused tests passed. Full Python1529 total:1495 passed,34 skipped,zero failures/errors in123.382s. Standard Node279 passed,zero failures/skips. Five new tests passed again after strengthening the corrupt-counter diagnostic assertion. Structural scan, dependency map, execution-policy and diff checks passed. Exact candidate CI/real sandbox remain pending. Simulator results are tracked separately and never inferred from Python/Node tests.

Initial fixture errors used a different repository tree against a real Journal scope and correctly raised CheckpointMismatch. Fixtures now use the existing authorized Session. The observed unmodified base has an empty diff fingerprint; tests require that exact initial marker and 64-character later revisions, retaining source-evidence assertions. These fixture corrections did not bypass controller scope checks.


Details: RECOVERY-STRATEGY-LIMITS.md and evidence/recovery-strategy-limits-local.json. This is partial010, not live model autonomy proof. Generation49bfb1d passed exact CI42284160952 and real sandbox42284161055. Native63db3b9 signing correction allowed all real Keychain bodies to run:4/5 passed,6/6 UI passed; remaining failure was a raw escaped-JSON assertion. Nativeff6ca5d decodes actual emitted metadata and retains secret-absence assertions;31 focused checks and CI42285739444 passed, supported simulator42285739711 remains in progress.

Native63db3b9 actual run42281885269: simulator signing/Keychain setup succeeded, all six UI tests passed and four of five native session tests passed. The remaining assertion at DeviceSessionTests.swift:60 compared raw JavaScript JSON wire text with an unescaped HTTPS URL. JSONSerialization legitimately emits escaped slashes. Replaced that incidental string assertion with decoding the actual emitted connection object and requiring exact id/backend dictionary equality; secret-absence checks remain. Added an executable JavaScript consumer regression with Swift-style escaped slash metadata, verifying exact bridge origin, short-token response and credential cleanup. All31 focused session/transport/bootstrap tests passed. Native overall remains failed pending the revised actual macOS run; no test removed, mocked Keychain substitution, skip or production serialization workaround.

## November6 durable tool observations

Eight deterministic regressions exercise actual tool loops, Explorer, Session and Journal with isolated GitHub/provider fixtures. They check>30k retained output, first-failure preservation, exact omitted-tail retrieval, Unicode/escaping and reconstructed hashes, source revision summary, real event rotation and restart, task-scope/private storage denial, cross-stage evidence preservation through provider429, bounded overflow, interrupted persistence and prompt-injection attempts against the tool allowlist. Model transport is scripted; no live reasoning or provider compatibility claim.

Initial composed Python1536 total/1502 passed/34 skipped,zero failures/errors in119.457s. Full Node964 passed,zero failures/skips. Structural10 rules and scan passed, with existing HTML warnings; map, execution policy and diff checks passed. An additional security regression and defensive malformed-type guards are included in the final Python rerun; exact result is tracked in TEST-EVIDENCE.md. Exact supported CI/real sandbox pending.

An initial new fixture incorrectly expected Explorer text to include prefixed line numbers; actual result carries ranges separately and plain source text. Corrected the expectation without changing production output. Initial Node invocation lacked this new worktree's jsdom dependency and failed one module load; linked existing lockfile-installed dependencies and reran the actual npm test successfully. Both failures are retained.


Exact strategy3fda30e CI42286813898/sandbox42286813709 passed. Nativeff6ca5d run42285739711 failed full UI acceptance despite5/5 Keychain tests. Separate native correction#350/64e4a8d passed966 Node checks; supported run42289413007 in progress. No production/main change, merge, paid inference or new autonomy score.

Final observation candidate Python1537 total/1503 passed/34 skipped,zero failures/errors in120.157s. This includes the added archive-injection negative and malformed-state guards. Node964 passed; no product source changed after this composed Python run. See evidence/durable-tool-observations-local.json for log/source hashes and the retained initial dependency failure. Exact supported CI/real sandbox remain pending.

## Nativeff6ca5d result and outside-tap correction

 run42285739711 compiled and passed all five real Keychain/session tests. Four of six UI tests passed. The composer test failed keyboard nonexistence after an outside tap; the log shows its text became the Plan a project suggestion. The fixed central percentage coordinate landed on an interactive chip after a lifecycle/viewport change, intentionally replacing the draft and refocusing. The secure enrollment UI test separately failed to find Settings after tapping More. The full native gate is failed;5/5 session tests are narrower evidence.


84 focused Node checks passed. Two new interaction regressions failed against the old bridge, then passed after click-capture correction. No native simulator pass yet; see NATIVE-TAP-LIFECYCLE.md.

Native outside-tap candidate full npm test:966 passed,zero failures/skips in23.215s. Bundle, config, dependency map, execution policy and diff checks passed. Supported native rerun remains required; no local Xcode pass inferred.

Observation candidate now locally composes native350/64e4a8d. All Python observation source/test hashes match the1537-test validated tree. Actual composed npm966 passed,zero failures/skips in22.934s; bundle/map/policy/diff checks passed. This is a local dependency merge only. Exact supported final tree CI/native/real sandbox remain mandatory.

## November6 request-size control-flow correction

Two regressions reproduced the previous adapter/generation failure onba6a9ea in an isolated detached worktree, then38 focused tests passed on the correction. Six new cases retain owner scope, bounded changing requests and failure provenance. Offline actual Groq admission confirms output reserve8192 exceeds its8000 free allowance before any useful input; no tokenizer/limit was relaxed and no live provider called. See REQUEST-SIZE-RECOVERY.md. Final full Python results pending.

Request-size candidate full Python1543 total/1509 passed/34 skipped,zero failures/errors in110.694s. Structural scan/map/reviewed execution policy passed. No JavaScript/native product files changed in this slice; earlier composed Node966 result remains a parent receipt, not a claimed new execution. Exact new supported CI/real sandbox pending. See evidence/request-size-recovery-local.json.

## November6 deletion retention candidate and verified receipts

Nine new cases execute actual frontend deletion/merge/sync/crypto functions against the actual Worker memory route and KappaMemory class, using two isolated VM replicas, authenticated fixture requests and in-memory storage. AES-GCM and160000-round PBKDF2 are real. Cases cover501 deletions/stale offline copy/reload, disjoint400+400 deletion sets, local persist failure, encrypted size exhaustion/no overwrite, incoming receipt persist failure, offline startup/export, goldenv1 read compatibility, authenticated downgrade rejection and the actual baseline v1 reader refusing to overwritev2. Five existing deletion/sync regressions remain. Four initial cases fail on the original code; final14 focused tests pass.

Full npm975 passed,zero failures/skips in23.468s. Initial pre-codec batch972 passed separately. Bundle/config/map/reviewed execution policy and final structural scan passed. The first map check correctly reported stale links; map regenerated and freshness rechecked. A new fixture initially assertedv2 before deletion while the intermediate codec still conditionally wrotev1; the final protocol deliberately always writesv2 and tests both the initial and large-history fence. No expectation was weakened. No Python product source changed from validated6ea6c46/Python1543; that parent evidence is separate from the new JavaScript/native candidate. Exact supported CI/native acceptance pending.


Bounded observation-history acceptance012 is VERIFIED at exactba6a9ea with tests42290343059, real sandbox42290343038 and native42290342842 all successful. Native64e4a8d run42289413007 independently confirms6/6 UI and5/5 session tests. Request-size6ea6c46 tests42291259094 and real sandbox42291431938 passed. These scoped receipts do not close037/043/017 or establish production/live-model success.
