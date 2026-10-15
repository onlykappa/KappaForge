import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            DashboardView().tabItem { Label("Dashboard", systemImage: "house") }
            ProjectsView().tabItem { Label("Projects", systemImage: "folder") }
            TasksView().tabItem { Label("Tasks", systemImage: "list.bullet") }
            SettingsView().tabItem { Label("Settings", systemImage: "gear") }
        }
    }
}

struct DashboardView: View {
    var body: some View { NavigationStack { List { Section("Recent Activity") { Text("No recent runs") } }.navigationTitle("Dashboard") } }
}

struct ProjectsView: View {
    var body: some View { NavigationStack { List(MockData.projects) { p in Text(p.name) }.navigationTitle("Projects") } }
}

struct TasksView: View {
    var body: some View { NavigationStack { List(MockData.tasks) { t in Text(t.title) }.navigationTitle("Tasks") } }
}

struct SettingsView: View {
    var body: some View { NavigationStack { Form { Section("Connection") { Text("Status: Demo Mode").foregroundColor(.secondary) } }.navigationTitle("Settings") } }