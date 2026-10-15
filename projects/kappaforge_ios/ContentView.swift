import SwiftUI

private enum ForgeStyle {
    static let accent = Color.indigo
    static let canvas = Color(uiColor: .systemGroupedBackground)
}

struct ContentView: View {
    var body: some View {
        TabView {
            DashboardView().tabItem { Label("Home", systemImage: "square.grid.2x2.fill") }
            ProjectsView().tabItem { Label("Projects", systemImage: "square.stack.fill") }
            TasksView().tabItem { Label("Tasks", systemImage: "checklist") }
            PullRequestsView().tabItem { Label("Reviews", systemImage: "arrow.triangle.pull") }
            SettingsView().tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
        .tint(ForgeStyle.accent)
    }
}

private struct FeatureCard<Content: View>: View {
    let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
    }
}

struct DashboardView: View {
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Your workspace").font(.subheadline).foregroundStyle(.secondary)
                            Text("Good to see you.").font(.title2.bold())
                        }
                        Spacer()
                        Image(systemName: "sparkles.rectangle.stack.fill")
                            .font(.title2).foregroundStyle(ForgeStyle.accent)
                            .padding(14)
                            .background(ForgeStyle.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 16))
                    }
                    FeatureCard {
                        Label("KappaForge Cloud", systemImage: "cloud")
                            .font(.headline)
                        Label("Demo mode", systemImage: "circle.dotted")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Text("Connect GitHub in a future update to view live agent runs.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    Text("Overview").font(.title3.bold())
                    HStack(spacing: 12) {
                        FeatureCard {
                            Image(systemName: "square.stack.3d.up").foregroundStyle(ForgeStyle.accent)
                            Text("\(MockData.projects.count)").font(.largeTitle.bold())
                            Text("Sample projects").font(.caption).foregroundStyle(.secondary)
                        }
                        FeatureCard {
                            Image(systemName: "checklist").foregroundStyle(ForgeStyle.accent)
                            Text("\(MockData.tasks.count)").font(.largeTitle.bold())
                            Text("Sample tasks").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Text("Activity").font(.title3.bold())
                    FeatureCard {
                        Label("No live activity yet", systemImage: "clock.arrow.circlepath")
                            .font(.headline)
                        Text("Your cloud build history will appear here once connected.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                .padding()
            }
            .background(ForgeStyle.canvas)
            .navigationTitle("KappaForge")
            .navigationBarTitleDisplayMode(.large)
        }
    }
}

struct ProjectsView: View {
    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(MockData.projects) { project in
                        HStack(spacing: 14) {
                            Image(systemName: "shippingbox.fill")
                                .foregroundStyle(ForgeStyle.accent)
                                .frame(width: 35, height: 35)
                                .background(ForgeStyle.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
                            VStack(alignment: .leading, spacing: 4) {
                                Text(project.name).font(.headline)
                                Text(project.status).font(.caption).foregroundStyle(.secondary)
                            }
                        }.padding(.vertical, 5)
                    }
                } header: { Text("Example repositories") }
            }
            .navigationTitle("Projects")
            .overlay(alignment: .bottom) {
                Text("Sample data, not connected to GitHub")
                    .font(.caption2).foregroundStyle(.secondary).padding(8)
            }
        }
    }
}

struct TasksView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Example tasks") {
                    ForEach(MockData.tasks) { task in
                        HStack {
                            Image(systemName: "circle").foregroundStyle(ForgeStyle.accent)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(task.title).font(.headline)
                                Text("Priority: \(task.priority)")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                        }.padding(.vertical, 5)
                    }
                }
                Section {
                    Label("Live task creation is coming later", systemImage: "info.circle")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Tasks")
        }
    }
}

struct PullRequestsView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Example pull requests") {
                    ForEach(MockData.prs) { request in
                        HStack(spacing: 12) {
                            Image(systemName: "arrow.triangle.pull")
                                .foregroundStyle(ForgeStyle.accent)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(request.title).font(.headline)
                                Text("By \(request.author)").font(.caption).foregroundStyle(.secondary)
                            }
                        }.padding(.vertical, 5)
                    }
                }
                Section {
                    Text("Reviews are read-only in this prototype.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Reviews")
        }
    }
}

struct SettingsView: View {
    var body: some View {
        NavigationStack {
            Form {
                Section("Connection") {
                    Label("Demo mode", systemImage: "wifi.slash")
                    Label("No accounts linked", systemImage: "person.crop.circle.badge.questionmark")
                }
                Section("About") {
                    LabeledContent("Application", value: "KappaForge iOS")
                    LabeledContent("Version", value: "0.2 prototype")
                    Text("Built with SwiftUI. Cloud operations are not yet connected.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
        }
    }
}
