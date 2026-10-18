# Agent safeguards and execution intelligence

This update is GitHub PR #99 because task issue #98 already occupied the number.
Baseline: main 324e27d, merged PR #97. No subsequent main commits were present when work began.

## Root cause and execution entry points

Previously `/chat` instructed the model to emit `kappa-action`; `receiveAssistant` returned it to `runChatAction`, which parsed model-written JSON and called `/plan`. `proposeTaskAutomatically` auto-launched safe modes, and `/jobs` accepted the boolean `approved`. A fallback also planned ordinary user messages even without an action block. Task #98 contains the exact UI example request and the assistant-generated unrelated regex fix.

Responses are now display-only. `runChatAction` routes only the immutable direct user turn. Generated plans, repository files, logs, attachments and prior responses supply context, never permissions. The planner's model output is advisory: deterministic classification caps its mode and the original request replaces its proposed instructions and repository selection.

Execution entry points:

| Entry | Enforcement |
| --- | --- |
| `/plan` | Direct-request intent ceiling; read-only investigation mode; no authority from model instructions |
| `/jobs` | Exact payload digest and single-use, conversation-bound authorization before issue creation/dispatch |
| `/retry`, `/guidance` | Fresh direct retry request or explicit control; cannot create a new task |
| `/decisions` | Confirmed exact PR action, prior exact-commit merge/test checks retained |
| `/undo` | Read-only preview remains available; confirmed mutation requires exact authorization |
| `/cancel` | Persistently revokes authorization and closes the bound task, stopping subsequent engine writes |
| Manual/scheduled agent and continuous workflows | Validate open owner task, mode, repository, expiry before using a write job |
| Engine GitHub writes | Re-read original issue before every privileged call; reject closure, changed scope, unrelated repo/branch, child tasks and default-branch writes |
| Authorized completion | Trusted main only, original explicit merge capability, exact independent test SHA, current checks, GitHub protections |

The existing bearer token remains the account authentication boundary. `/authorize` is an authenticated first-party user-input endpoint. It is not exposed as a model tool. An owner deliberately submitting requests with that credential has the owner's authority. This is not a sandbox against a compromised first-party client or malicious account owner.

## State, recovery and compatibility

The Durable Object serializes authorization issuance, claim, cancellation and task binding. A claim expires after 30 minutes; a running task's provenance expires after 24 hours. Repeated IDs cannot create duplicate jobs. Claimed requests are never automatically replayed after an uncertain network response. Issue metadata carries request/conversation identity, exact scope and expiry across process interruption. Owner-authored manual tasks expire after one day. Legacy chat tasks without provenance fail closed and need a new user request.

Planning, execution, verification and final states are distinct in the engine lifecycle. Real task events persist frontend checkpoints. Recovery rejects duplicate proposals and has a shared bounded budget. Global unrelated repair scanning is disabled. Trusted independent CI can still start a repair of the same authorized task. It cannot grant a new task scope.

Explicit `fix ... and merge it` requests carry a merge capability. A trusted completion workflow checks that capability after secret-free sandbox/project tests, verifies the exact PR head and current checks, and attempts a SHA-bound merge subject to repository protections. Ordinary fix requests produce draft PRs. Publishing and deployment retain their existing release gates and explicit controls.

Intent recognition deliberately defaults ambiguous conversational follow-ups to no execution. Semantic relevance of a code change is still constrained by the original task and existing path/validation rules; a deterministic word classifier is not proof that every generated implementation is semantically correct. Tests and review remain necessary.

## Native input

The previous descendant traversal cleared `inputAssistantItem`, but did not reliably remove WebKit's form-navigation accessory on iPhone. Chat now uses a public UIKit `UITextView`; its `inputAccessoryView` is nil and assistant groups are empty. The HTML editor remains the browser input and becomes a read-only geometry/text anchor in the native app. Revision numbers reject stale bridge updates, and the native editor inherits the interface text color/size.

UIKit keyboard-frame notifications supply native occlusion. VisualViewport remains the browser path. SwiftUI ignores keyboard safe-area repositioning, and only one CSS keyboard offset applies. Settings/search keep their normal web controls. The bridge checks the bundled main-frame file origin before accepting messages. Application identity, WebKit data storage, credentials and native update integration remain unchanged.

Public API references:
- https://developer.apple.com/documentation/uikit/uitextview/inputaccessoryview
- https://developer.apple.com/documentation/uikit/uitextinputassistantitem

## Verification

Local: Python unit suite, JavaScript integration/adversarial suite, shared bundle/syntax validation, and native update contract tests. CI additionally builds simulator and device targets, runs XCTest focus/dismissal/multiline/background tests, exports keyboard-open/closed screenshots, and runs Chromium/WebKit regression and accessibility tests. Artifacts are attached to the corresponding CI runs.

Physical iPhone behavior, hardware keyboards, third-party keyboards, and all accessibility configurations cannot be confirmed by simulator CI. A real-device check remains necessary before claiming identical physical iPhone behavior. No merge or release is performed while required gates are unresolved.
