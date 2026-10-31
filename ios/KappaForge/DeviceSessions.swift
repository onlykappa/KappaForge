import Foundation
import Security

struct DeviceSessionRecord: Codable, Equatable {
    let backend: String
    let id: String
    let renewal: String
}

// A separate Keychain item preserves the old owner recovery credential. Neither
// the owner credential nor this renewal secret is serialized into WebKit.
enum DeviceSessionVault {
    private static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.onlykappa.KappaForge.backend", kSecAttrAccount as String: "device-session-v1"]
    static func load() -> DeviceSessionRecord? {
        var result: CFTypeRef?
        let attributes = query.merging([kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]) { _, new in new }
        guard SecItemCopyMatching(attributes as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(DeviceSessionRecord.self, from: data)
    }
    static func save(_ record: DeviceSessionRecord) throws {
        let data = try JSONEncoder().encode(record)
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            guard SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil) == errSecSuccess else { throw DeviceSessionError.storage }
        } else if status != errSecSuccess { throw DeviceSessionError.storage }
    }
    static func delete() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw DeviceSessionError.storage }
    }
}

enum DeviceSessionError: Error { case configuration, response, storage, changed }

// Do not follow even a same-origin redirect carrying a credential. Cookies and
// shared caches are also disabled; the only admitted path is /sessions.
final class SessionRedirectDenial: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

@MainActor enum DeviceSessions {
    #if DEBUG
    // XCTest injects URLProtocol through a trusted native test host. This hook
    // is absent from release builds and is never exposed through WebKit.
    static var testSessionFactory: ((URLSessionConfiguration, URLSessionTaskDelegate) -> URLSession)?
    #endif
    static func origin(_ raw: String) throws -> String {
        guard let parts = URLComponents(string: raw), parts.scheme == "https", let host = parts.host,
              host.hasSuffix(".workers.dev"), parts.user == nil, parts.password == nil,
              parts.port == nil || parts.port == 443, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/" else { throw DeviceSessionError.configuration }
        return "https://" + host.lowercased()
    }
    private static func call(backend: String, credential: String, body: [String: Any]) async throws -> [String: Any] {
        let approved = try origin(backend)
        guard !credential.isEmpty, credential.utf8.count < 4096,
              credential.rangeOfCharacter(from: .controlCharacters) == nil,
              let url = URL(string: approved + "/sessions") else { throw DeviceSessionError.configuration }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"; request.timeoutInterval = 15
        request.setValue("Bearer " + credential, forHTTPHeaderField: "Authorization")
        request.setValue("null", forHTTPHeaderField: "Origin")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false; config.urlCache = nil
        let delegate = SessionRedirectDenial()
        #if DEBUG
        let session = testSessionFactory?(config, delegate) ?? URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
        #else
        let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
        #endif
        defer { session.invalidateAndCancel() }
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse, [200,201].contains(http.statusCode),
              response.url == url else { throw DeviceSessionError.response }
        var data = Data()
        for try await byte in bytes {
            guard data.count < 64000 else { throw DeviceSessionError.response }
            data.append(byte)
        }
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw DeviceSessionError.response }
        return value
    }
    static func enroll(backend: String, owner: String) async throws {
        let approved = try origin(backend)
        var body: [String: Any] = ["op":"enroll", "label":"KappaForge iOS", "scopes":["assistant","tasks"]]
        if let previous = DeviceSessionVault.load() {
            guard previous.backend == approved else { throw DeviceSessionError.changed }
            body["op"] = "reenroll"; body["deviceId"] = previous.id
        }
        let result = try await call(backend: approved, credential: owner, body: body)
        guard let device = result["device"] as? [String: Any], let id = device["id"] as? String, UUID(uuidString: id) != nil,
              let renewal = result["refreshToken"] as? String,
              renewal.range(of: "^kfr_" + NSRegularExpression.escapedPattern(for: id) + "\\.[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { throw DeviceSessionError.response }
        try DeviceSessionVault.save(DeviceSessionRecord(backend: approved, id: id, renewal: renewal))
    }
    static func renew(expectedOrigin: String) async throws -> [String: Any] {
        guard let record = DeviceSessionVault.load(), record.backend == expectedOrigin else { throw DeviceSessionError.configuration }
        let result = try await call(backend: record.backend, credential: record.renewal, body: ["op":"renew"])
        guard DeviceSessionVault.load() == record else { throw DeviceSessionError.changed }
        guard let token = result["accessToken"] as? String,
              token.range(of: "^kfa_" + NSRegularExpression.escapedPattern(for: record.id) + "\\.[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              let expires = result["accessExpiresAt"] as? Double, expires.isFinite,
              expires > Date().timeIntervalSince1970 * 1000, expires <= Date().timeIntervalSince1970 * 1000 + 301000 else { throw DeviceSessionError.response }
        // Return only short-lived access. No renewal/root value crosses the bridge.
        return ["accessToken":token, "accessExpiresAt":expires]
    }
    static func disconnect() async throws {
        guard let record = DeviceSessionVault.load() else { return }
        _ = try await call(backend: record.backend, credential: record.renewal, body: ["op":"disconnect"])
        guard DeviceSessionVault.load() == record else { throw DeviceSessionError.changed }
        try DeviceSessionVault.delete()
    }
}
