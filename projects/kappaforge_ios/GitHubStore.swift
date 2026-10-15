import Foundation
import SwiftUI

struct GHRepo: Decodable, Identifiable {
    let id: Int
    let name: String
    let full_name: String
    let description: String?
    let html_url: URL
    let updated_at: Date
    let open_issues_count: Int
}
struct GHIssue: Decodable, Identifiable {
    let id: Int
    let number: Int
    let title: String
    let html_url: URL
    let repository: String
    var pull_request: GHLink?
    enum CodingKeys: String, CodingKey { case id, number, title, html_url, pull_request }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        number = try c.decode(Int.self, forKey: .number)
        title = try c.decode(String.self, forKey: .title)
        html_url = try c.decode(URL.self, forKey: .html_url)
        pull_request = try c.decodeIfPresent(GHLink.self, forKey: .pull_request)
        repository = decoder.userInfo[.repoName] as? String ?? ""
    }
}
struct GHLink: Decodable { let url: URL? }
struct GHRun: Decodable, Identifiable {
    let id: Int
    let name: String?
    let status: String
    let conclusion: String?
    let html_url: URL
}
private struct RunEnvelope: Decodable { let workflow_runs: [GHRun] }
extension CodingUserInfoKey {
    static let repoName = CodingUserInfoKey(rawValue: "repoName")!
}

@MainActor
final class ForgeStore: ObservableObject {
    @Published var repositories: [GHRepo] = []
    @Published var issues: [GHIssue] = []
    @Published var reviews: [GHIssue] = []
    @Published var runs: [GHRun] = []
    @Published var loading = false
    @Published var error: String?
    @Published var updatedAt: Date?
    private let names = ["KappaForge", "OmniPC", "Apk-revival"]
    private let root = URL(string: "https://api.github.com/repos/onlykappa/")!

    func refresh() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let repos: [GHRepo] = try await withThrowingTaskGroup(of: GHRepo.self) { group in
                for name in names { group.addTask { try await self.fetch(name, as: GHRepo.self) } }
                var collected: [GHRepo] = []
                for try await item in group { collected.append(item) }
                return collected.sorted { $0.name < $1.name }
            }
            var tasks: [GHIssue] = []
            var prs: [GHIssue] = []
            for name in names {
                let results = try await issueList(name, endpoint: "issues")
                tasks += results.filter { $0.pull_request == nil }
                prs += try await issueList(name, endpoint: "pulls")
            }
            let activity: RunEnvelope = try await fetch("KappaForge/actions/runs?per_page=10", as: RunEnvelope.self)
            repositories = repos
            issues = tasks
            reviews = prs
            runs = activity.workflow_runs
            updatedAt = .now
            error = nil
        } catch {
            self.error = "Could not refresh GitHub data: \(error.localizedDescription)"
        }
    }

    private func issueList(_ repo: String, endpoint: String) async throws -> [GHIssue] {
        let url = root.appending(path: repo + "/" + endpoint)
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "state", value: "open"),
                                 URLQueryItem(name: "per_page", value: "30")]
        var request = URLRequest(url: components.url!)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response)
        let decoder = makeDecoder()
        decoder.userInfo[.repoName] = repo
        return try decoder.decode([GHIssue].self, from: data)
    }

    private func fetch<T: Decodable>(_ path: String, as: T.Type) async throws -> T {
        let url = root.appending(path: path)
        var request = URLRequest(url: url)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response)
        return try makeDecoder().decode(T.self, from: data)
    }
    private func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
    private func validate(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
    }
}
