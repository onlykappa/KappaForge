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
    var body: some View {
        ZStack {
            KappaWebView(showSecurity: { showSettings = true })
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
                SettingsView().environmentObject(security)
                    .navigationTitle("Device security")
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showSettings = false } } }
            }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var security: AppSecurity
    @State private var updateStatus = ""
    @State private var downloadURL: URL?
    @State private var isChecking = false

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
                if let downloadURL {
                    ShareLink(item: downloadURL) {
                        Label("Get latest IPA", systemImage: "arrow.down.circle")
                    }
                    Text("Download the IPA in Safari, then use Share or Files to import it into SideStore. SideStore signs and installs updates on your phone once it is configured. Keep the same Apple signing account and app identifier to preserve data.")
                        .font(.footnote)
                }
            }
            Section("About") {
                LabeledContent("App", value: "KappaForge for iOS")
                Text("The chat interface is built into this application. Online AI features still connect to your configured backend.")
                    .font(.footnote)
            }
        }
    }

    @MainActor
    private func checkUpdates() async {
        isChecking = true
        downloadURL = nil
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
                if let asset = release.assets.first(where: { $0.name.hasSuffix(".ipa") }) {
                    downloadURL = URL(string: asset.browser_download_url)
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
