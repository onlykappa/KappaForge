# Source-backed review citation transport

P3-064 addresses repeated invalid quote/range formatting in task308 without changing what evidence is accepted. The server now supplies a bounded catalog of references to source spans already displayed in the same review prompt. A model may choose an exact catalog id instead of retyping source text or line endpoints.

Each reference binds path, full-source fingerprint and a span of at most eight contiguous displayed lines. There are at most eight entries per path and32 per prompt. Candidates are ranked using task/diff terms; changed paths are considered first. This ranking is a routing aid, not proof that any requirement is met. The source/owner text remains untrusted evidence.

The model still supplies its own met/necessary decision and scope reason. The resolver accepts only an id from the server's current catalog, requires the same path for a file-scope decision, and copies exact current source lines. Existing literal/executable checks and original-requirement coverage still run. No empty placeholder, unknown id, old-snapshot id, model-supplied replacement catalog or different-file scope reference can complete verification. Existing quote/line input remains supported. A missing supporting span leaves the claim unproved or calls for more source; the engine never manufactures a positive verdict.

The catalog is ephemeral review data. It grants no task, mutation, merge, deployment or model-budget authority. It adds no inference attempt; the existing bounded format retry remains unchanged. Source/candidate/concurrency and owner-scope guards remain in place.

Regressions invoke production model_review with fake transport. Positive checks exercise id-to-source resolution; negative checks cover invented/missing proof, invalid spans, owner wording, wrong-file scope references, stale snapshots and model-supplied catalogs. The earlier quote/line compatibility tests remain. A wording regression in the existing overhead suite was fixed by retaining its required Every met:true requirement must include evidence phrase; no assertion was weakened.

Validation and live-trial outcome are recorded under P3-064 in issue-log.md. Passing scripted transport is not an accepted live model review or task completion.

P3-065 extends the same typed transport to behavioral test proof and saved requirement texts alongside classified ids. Missing saved decisions use the existing format retry and remain incomplete if omitted again. The end-to-end regression exercises check_the_work, real source resolution and the requirement/test matrix: a complete review clears the old pending ask; omitting it blocks completion. No history or default verdict is cleared by the template itself.
