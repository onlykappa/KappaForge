# KappaForge iOS and iPadOS

Native SwiftUI demo shell targeting iOS 17 and later.

## Current milestone

Five working navigation screens: Dashboard, Projects, Tasks, Pull Requests, and Settings.
All listed projects, tasks and pull requests are **mock data**, not live GitHub information.
No GitHub tokens, API keys, billing credentials or sign-in features exist in this build.

## Build with Xcode

1. Install Xcode and XcodeGen on a Mac (`brew install xcodegen`).
2. From this directory, run `xcodegen generate`.
3. Open `KappaForge.xcodeproj`, select an iOS Simulator, and build.
4. The project intentionally disables code signing for the current simulator build.

## Build in GitHub Actions (no Mac required)

Open KappaForge > Actions > **iOS simulator build** > Run workflow.
Use the branch `kappa/issue-4` and keep the workflow on `main`.
The macOS runner generates the Xcode project and compiles the simulator target.
A successful result confirms a simulator build, **not** an installable or signed IPA.

## Next milestones

- Read-only GitHub API client and test fixtures.
- Secure GitHub App or OAuth authentication, with no long-lived tokens committed to source.
- Real tasks, runs, audit status and draft PRs.
- Device install/signing and iPad adaptive layout.
