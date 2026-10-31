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
