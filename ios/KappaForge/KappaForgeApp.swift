import SwiftUI

@main
struct KappaForgeApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct RootView: View {
    @State private var showSettings = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            KappaWebView()
                .ignoresSafeArea(.container, edges: .bottom)
            Button {
                showSettings = true
            } label: {
                Image(systemName: "gearshape.fill")
                    .font(.title3)
                    .padding(13)
                    .background(.regularMaterial, in: Circle())
            }
            .accessibilityLabel("Native app settings")
            .padding(.trailing, 14)
            .padding(.bottom, 90)
        }
        .sheet(isPresented: $showSettings) {
            NavigationStack {
                SettingsView()
                    .navigationTitle("KappaForge")
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showSettings = false }
                        }
                    }
            }
        }
    }
}

struct SettingsView: View {
    var body: some View {
        List {
            Section("About") {
                LabeledContent("App", value: "KappaForge for iOS")
                LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Development")
            }
            Section("Updates") {
                Text("App Store builds update through the App Store. Test builds update through TestFlight or a new signed installation. The embedded KappaForge interface updates from the server automatically.")
                    .font(.footnote)
                Link("Check App Store", destination: URL(string: "https://apps.apple.com/")!)
            }
            Section("Account migration") {
                Text("Safari and Home Screen app storage cannot be accessed directly by a native app. A future pairing flow will securely import existing chats and credentials. Until then the native app has its own connection settings.")
                    .font(.footnote)
            }
        }
    }
}
