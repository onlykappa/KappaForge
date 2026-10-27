# Response room for complete verification JSON

Run [40462378246](https://github.com/onlykappa/KappaForge/actions/runs/40462378246)
logged 12 gateway calls: eight verification, three review and one coding. It hit
the existing 12-proposal effort limit and published no new output. Several early
provider attempts ended with `output_limit` while verification requested only
700–1,000 output tokens. Later verification also returned unanswered findings.
This run reached more stages, but did not complete checkpoint 3.1a.

Finding verification now requests `min(3500, 2048 + 256 * finding_count)` output
tokens. Typical one/two/four-finding batches receive 2304/2560/3072, retaining
the existing 3500 maximum. Literal evidence can contain a long provenance row;
some routes also consume output tokens before emitting the JSON response.
Repeatedly requesting too little room can cause more fallback calls.

This changes the requested response allowance, not provider limits or the input
budget. The 20,000-character engine prompt cap, request/context guards, output
reserve, 12-proposal effort limit, cumulative counters, three verifier attempts,
literal evidence and final provenance checks stay in force. Paid Worker limits
and provider quotas are unchanged. Incomplete answers still authorize nothing.

The same scripted truncation fixture ran against main
`b4c66e767ab80c35cd14c6b7dc54363ba5c7d0bb` and the patch through the actual
finding-verification and gateway boundary code. The fixture contains a valid
long literal-evidence JSON response and models tokens as ceil(UTF-8 bytes / 3).
This approximation is explicit, not a claim about any provider's tokenizer.

| Controlled fixture | Baseline | Patch |
| --- | ---: | ---: |
| Gateway adapter calls | 3 | 1 |
| Verification calls | 3 | 1 |
| Truncated fixture responses | 3 | 0 |
| Usable source-bound verdict | No | Yes |

There were no live HTTP requests in this replay. It demonstrates the bounded
truncation path, not general provider accuracy or full 3.1a fulfillment. A
second test keeps responses partial regardless of allowance and verifies the
same bounded fail-closed outcome. PR #284 remains draft until actual work and
evidence are verified, with task #282 restricted to checkpoint 3.1a.
