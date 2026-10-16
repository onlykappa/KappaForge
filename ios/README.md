# KappaForge iOS, native starter

This is an **XcodeGen SwiftUI iOS application** wrapping the existing KappaForge interface inside a native WKWebView, with a native iOS Files document picker, native Settings sheet, and restricted top-level navigation. It is source code, **not yet a signed downloadable iPhone app**.

## Local build

1. On a Mac with Xcode, install XcodeGen (https://github.com/yonaskolb/XcodeGen).
2. `cd ios && xcodegen generate`.
3. Open `KappaForge.xcodeproj` and select a signing team for `com.onlykappa.KappaForge` (change the bundle ID if needed).
4. Run on the iPhone or distribute an App Store Connect / TestFlight build.

The GitHub iOS CI workflow compiles simulator and iPhone device builds **without signing** and publishes the unsigned `KappaForge-unsigned.ipa` in the `KappaForge-unsigned-iPhone-IPA` workflow artifact (retained for 14 days). A compatible sideloader must sign this IPA with valid Apple provisioning before installation. The native WKWebView loads Web/index.html bundled inside the IPA. The UI does not navigate to GitHub Pages. AI/chat and cloud memory still need a reachable configured Cloudflare Worker and network access. Update the IPA to update the bundled UI.

## Migration and versions

Native WKWebView storage is **not shared** with Safari or the standalone Home Screen app. The first build will require reconnecting AI unless a secure, user-authorized transfer flow is implemented and tested. Do not embed personal API keys or access tokens in this public source repository.

The bundled interface can be updated only by installing a new signed IPA. An installed signed iOS binary can only be replaced through Apple's approved distribution process (App Store, TestFlight or managed distribution). Native silent binary self-update is not supported.

The initial native version bundles a snapshot of the existing web interface, rather than downloading it at launch. Offline full project analysis, background execution, native push notifications and account migration are separate milestones.
