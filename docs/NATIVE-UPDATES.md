# Native KappaForge updates (SideStore)

The app starts from the locally bundled `Web/index.html`. GitHub Pages or the preview website are **not used at runtime**. AI and cloud memory still require the configured Cloudflare Worker API.

## Update flow

1. Tap the Update icon in the bundled KappaForge interface. The native iOS bridge opens the device settings sheet.
2. In **Updates**, tap **Check for Updates**. The app checks the latest GitHub release through the GitHub API and compares its version to `CFBundleShortVersionString`.
3. If a release contains the exact `KappaForge-unsigned.ipa` asset, tap **Download IPA for SideStore**. The app downloads the release asset to a temporary local file and checks that it has a plausible size and a ZIP header.
4. Tap **Install with SideStore**, select SideStore in the iOS share sheet, and follow SideStore's signing/install prompts. If SideStore does not appear, save the IPA in Files and import from SideStore's **My Apps** tab.

This is **not** silent self-updating, and does not bypass signing, App ID limits, the 7-day free-account expiry, or user confirmation. IPA installs still depend on SideStore compatibility and LocalDevVPN/pairing.

## Preserving data

Keep `com.onlykappa.KappaForge` unchanged, install as an upgrade instead of deleting the app, and use the same Apple signing account/team where possible. The native app uses WebKit's persistent default data store and iOS Keychain; it does not intentionally erase either during updates. iOS can still treat an install as a new app if signing/team, bundle ID, or SideStore installation identity changes. **Back up conversations and connection settings before the first upgrade.** No migration or restoration across changed team IDs is guaranteed.

## Releasing

A main-branch build validates and packages an **unsigned** IPA, then the workflow publishes versioned GitHub Releases. Increment `MARKETING_VERSION` in `ios/project.yml` and the web bundle version before creating a new release; a release tag is immutable within the workflow. Build checks must pass before publishing. Avoid renaming the IPA asset without updating the native updater.

## Validation

Run `node --test tests/native-update-contract.test.mjs` for the wiring checks, then use the macOS GitHub Actions iOS workflow for real Swift compilation and simulator tests. Finally install and upgrade on a physical SideStore device and verify local conversations, memory, and credentials remain available.
