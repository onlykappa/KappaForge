import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            DashboardView().tabItem { Label("Dashboard", systemImage: "house") }
            ProjectsView().tabItem { Label("Projects", systemImage: "folder") }
            TasksView().tabItem { Label("Tasks", systemImage: "list.bullet") }
            PullRequestsView().tabItem { Label("PRs", systemImage: "arrow.triangle.pull") }
            SettingsView().tabItem { Label("Settings", systemImage: "gear") }
        }
    }
}

struct DashboardView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Cloud agent") {
                    Label("Demo mode: GitHub connection pending", systemImage: "cloud")
                }
                Section("Recent activity") {
                    Text("No live runs yet").foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Dashboard")
        }
    }
}

struct ProjectsView: View {
    var body: some View {
        NavigationStack {
            List(MockData.projects) { project in
                VStack(alignment: .leading) {
                    Text(project.name).font(.headline)
                    Text(project.status).font(.caption).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Projects")
        }
    }
}

struct TasksView: View {
    var body: some View {
        NavigationStack {
            List(MockData.tasks) { task in
                VStack(alignment: .leading) {
                    Text(task.title).font(.headline)
                    Text("Priority: \(task.priority)").font(.caption).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Tasks")
        }
    }
}

struct PullRequestsView: View {
    var body: some View {
        NavigationStack {
            List(MockData.prs) { request in
                VStack(alignment: .leading) {
                    Text(request.title).font(.headline)
                    Text(request.author).font(.caption).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Pull Requests")
        }
    }
}

struct SettingsView: View {
    var body: some View {
        NavigationStack {
            Form {
                Section("Connection") {
                    Label("Demo mode", systemImage: "lock.shield")
                    Text("No GitHub credentials are stored.")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
        }
    }
}
