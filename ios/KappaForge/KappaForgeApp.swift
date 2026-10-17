import SwiftUI

@main
struct KappaForgeApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var security = AppSecurity()
    @State private var showSettings = false
    @State private var showUpdatesOnOpen = false
    var body: some View {
        ZStack {
            KappaWebView(showSecurity: { showUpdatesOnOpen = false; showSettings = true },
                         showUpdates: { showUpdatesOnOpen = true; showSettings = true })
                .ignoresSafeArea(.container, edges: .bottom)
                .allowsHitTesting(security.unlocked && scenePhase == .active)
                .accessibilityHidden(!security.unlocked || scenePhase != .active)
            if !security.unlocked || scenePhase != .active {
                VStack(spacing: 22) {
                    Image(systemName: "lock.shield.fill").font(.system(size: 44)).foregroundStyle(.indigo)
                    Text("KappaForge is locked").font(.title2.bold())
                    Text(security.message).font(.footnote).multilineTextAlignment(.center)
                    Button(security.authenticating ? "Authenticating…" : "Unlock KappaForge") { security.authenticate() }
                        .buttonStyle(.borderedProminent).disabled(security.authenticating)
                }.padding(28).frame(maxWidth: .infinity, maxHeight: .infinity).background(.background)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { security.lock() }
        }
        .sheet(isPresented: $showSettings) {
            NavigationStack {
                SettingsView(checkOnAppear: showUpdatesOnOpen).environmentObject(security)
                    .navigationTitle("Device security")
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showSettings = false } } }
            }
        }
    }
}

struct SettingsView: View {
    let checkOnAppear: Bool
    @EnvironmentObject private var security: AppSecurity
    @State private var updateStatus = ""
    @State private var downloadedIPA: URL?
    @State private var releaseAssetURL: URL?
    @State private var isChecking = false
    @State private var isDownloading = false
    @State private var releaseVersion = ""

    private var currentVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
    }

    var body: some View {
        List {
            Section("App lock") {
                LabeledContent("Biometric app lock", value: security.enabled ? "Enabled" : "Disabled")
                Button(security.enabled ? "Disable app lock" : "Enable Face ID / Touch ID") {
                    if security.enabled { security.disable() } else { security.authenticate(enabling: true) }
                }.disabled(security.authenticating)
                if !security.message.isEmpty { Text(security.message).font(.footnote) }
                Text("Locks at cold launch and when the app enters the background. Device passcode is available for recovery. Credentials are stored in the iOS Keychain after successful migration.").font(.footnote)
            }
            Section("Updates") {
                LabeledContent("Installed version", value: currentVersion)
                Button(isChecking ? "Checking..." : "Check for Updates") {
                    Task { await checkUpdates() }
                }
                .disabled(isChecking)
                if !updateStatus.isEmpty { Text(updateStatus).font(.footnote) }
                if let releaseAssetURL {
                    if let downloadedIPA {
                        ShareLink(item: downloadedIPA, preview: SharePreview("KappaForge v\(releaseVersion)")) {
                            Label("Install with SideStore", systemImage: "square.and.arrow.up")
                        }
                        .disabled(isDownloading)
                    } else {
                        Button(isDownloading ? "Downloading IPA..." : "Download IPA for SideStore") {
                            Task { await downloadIPA(from: releaseAssetURL) }
                        }
                        .disabled(isDownloading)
                    }
                    Text("Select SideStore from the iOS share sheet. SideStore must sign and install the IPA. Do not delete the existing app. Use the same Apple ID/team and bundle identifier to retain the app container.")
                        .font(.footnote)
                }
            }
            Section("About") {
                LabeledContent("App", value: "KappaForge for iOS")
                Text("The chat interface is built into this application. Online AI features still connect to your configured backend.")
                    .font(.footnote)
            }
        }
        .task { if checkOnAppear { await checkUpdates() } }
    }

    // Download a real IPA file to the device before sharing. Sharing a remote URL
    // only sends a web link, which SideStore cannot install as an IPA.
    @MainActor
    private func downloadIPA(from url: URL) async {
        guard url.scheme == "https",
              url.host == "github.com",
              url.path.hasPrefix("/onlykappa/KappaForge/releases/download/"),
              url.path.lowercased().hasSuffix(".ipa") else {
            updateStatus = "Untrusted release download URL."
            return
        }
        isDownloading = true
        defer { isDownloading = false }
        do {
            let (temporaryURL, response) = try await URLSession.shared.download(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                throw URLError(.badServerResponse)
            }
            let values = try FileManager.default.attributesOfItem(atPath: temporaryURL.path)
            let size = values[.size] as? Int64 ?? 0
            guard size > 1024, size < 250_000_000 else {
                updateStatus = "The downloaded IPA has an invalid size."
                return
            }
            let signature = try FileHandle(forReadingFrom: temporaryURL)
            defer { try? signature.close() }
            guard try signature.read(upToCount: 4) == Data([0x50, 0x4b, 0x03, 0x04]) else {
                updateStatus = "Download was not an IPA archive."
                return
            }
            let destination = FileManager.default.temporaryDirectory
                .appendingPathComponent("KappaForge-\(releaseVersion).ipa")
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.copyItem(at: temporaryURL, to: destination)
            downloadedIPA = destination
            updateStatus = "IPA downloaded. Tap Install with SideStore and choose SideStore from the share sheet."
        } catch {
            updateStatus = "IPA download failed. Check your connection and try again."
        }
    }

    @MainActor
    private func checkUpdates() async {
        isChecking = true
        downloadedIPA = nil
        releaseAssetURL = nil
        defer { isChecking = false }
        guard let url = URL(string: "https://api.github.com/repos/onlykappa/KappaForge/releases/latest") else { return }
        do {
            var request = URLRequest(url: url)
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            request.timeoutInterval = 15
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                updateStatus = "No published release available yet. Please check again later."
                return
            }
            let release = try JSONDecoder().decode(KappaRelease.self, from: data)
            let availableVersion = release.tag_name.trimmingCharacters(in: CharacterSet(charactersIn: "vV"))
            if availableVersion.compare(currentVersion, options: .numeric) == .orderedDescending {
                updateStatus = "Version \(availableVersion) is available. Download it and open with SideStore to install."
                if let asset = release.assets.first(where: { $0.name == "KappaForge-unsigned.ipa" }) {
                    releaseAssetURL = URL(string: asset.browser_download_url)
                } else {
                    updateStatus = "A newer release exists but has no downloadable IPA yet."
                }
            } else {
                updateStatus = "You're up to date (v\(currentVersion))."
            }
        } catch {
            updateStatus = "Could not check updates. Try again when connected to the internet."
        }
    }
}

private struct KappaRelease: Decodable {
    let tag_name: String
    let assets: [KappaReleaseAsset]
}

private struct KappaReleaseAsset: Decodable {
    let name: String
    let browser_download_url: String
}
