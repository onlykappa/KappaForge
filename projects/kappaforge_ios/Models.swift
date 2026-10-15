import Foundation

struct Project: Identifiable { let id: UUID = UUID(); let name: String; let status: String }
struct Task: Identifiable { let id: UUID = UUID(); let title: String; let priority: String }
struct PullRequest: Identifiable { let id: UUID = UUID(); let title: String; let author: String }

struct MockData {
    static let projects = [Project(name: "KappaForge", status: "Active"), Project(name: "OmniPC", status: "Archived")]
    static let tasks = [Task(title: "Fix CI Pipeline", priority: "High"), Task(title: "Update Docs", priority: "Low")]
    static let prs = [PullRequest(title: "Refactor Auth", author: "dev_user")]
}