import XCTest
import WebKit
@testable import KappaForge

final class SessionProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            guard let handler = Self.handler else { throw URLError(.unsupportedURL) }
            let (status, data) = try handler(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type":"application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

final class DeviceSessionTests: XCTestCase {
    private let origin = "https://isolated-fixture.workers.dev"
    private let id = "12345678-1234-1234-1234-123456789abc"
    private var previous: DeviceSessionRecord?
    private var record: DeviceSessionRecord { DeviceSessionRecord(backend: origin, id: id, renewal: "kfr_" + id + "." + String(repeating: "R", count: 43)) }
    override func setUpWithError() throws {
        previous = DeviceSessionVault.load(); try DeviceSessionVault.delete()
    }
    override func tearDownWithError() throws {
        if let previous { try DeviceSessionVault.save(previous) } else { try DeviceSessionVault.delete() }
        SessionProtocol.handler = nil
    }
    @MainActor private func useFixture(_ handler: @escaping (URLRequest) throws -> (Int, Data)) {
        SessionProtocol.handler = handler
        DeviceSessions.testSessionFactory = { configuration, delegate in
            configuration.protocolClasses = [SessionProtocol.self]
            return URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        }
    }
    @MainActor func testExactOriginPolicyRejectsCredentialAndRedirectTargets() throws {
        XCTAssertEqual(try DeviceSessions.origin(origin + "/"), origin)
        for value in ["http://isolated-fixture.workers.dev", origin + "/other", origin + "?key=secret", origin + "#secret",
                      "https://root:secret@isolated-fixture.workers.dev", "https://isolated-fixture.workers.dev.evil.test", origin + ":8443"] {
            XCTAssertThrowsError(try DeviceSessions.origin(value))
        }
    }
    @MainActor func testNativeEnrollmentUsesKeychainAndPublicOnlyBootstrap() async throws {
        defer { DeviceSessions.testSessionFactory = nil }
        let expected = record
        useFixture { request in
            XCTAssertEqual(request.url?.absoluteString, self.origin + "/sessions")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer isolated-owner-fixture")
            return (201, try JSONSerialization.data(withJSONObject: ["device":["id":expected.id],"refreshToken":expected.renewal]))
        }
        try await DeviceSessions.enroll(backend: origin, owner: "isolated-owner-fixture")
        XCTAssertEqual(DeviceSessionVault.load(), expected)
        let script = KappaWebView.credentialScript().source
        XCTAssertFalse(script.contains(expected.renewal)); XCTAssertFalse(script.contains("isolated-owner-fixture"))
        XCTAssertTrue(script.contains(expected.id)); XCTAssertTrue(script.contains(expected.backend))
        XCTAssertTrue(script.contains("localStorage.removeItem('kappaforge.access')"))
    }
    @MainActor func testRenewalReturnsOnlyShortAccessAndDisconnectDeletesAfterServerReceipt() async throws {
        defer { DeviceSessions.testSessionFactory = nil }
        try DeviceSessionVault.save(record)
        let access = "kfa_" + id + "." + String(repeating: "A", count: 43), expected = record
        useFixture { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer " + expected.renewal)
            return (200, try JSONSerialization.data(withJSONObject: ["accessToken":access,"accessExpiresAt":Int64(Date().timeIntervalSince1970 * 1000) + 300000]))
        }
        let value = try await DeviceSessions.renew(expectedOrigin: origin)
        XCTAssertEqual(Set(value.keys), Set(["accessToken","accessExpiresAt"]))
        XCTAssertEqual(value["accessToken"] as? String, access)
        useFixture { _ in (200, Data("{}".utf8)) }
        try await DeviceSessions.disconnect(); XCTAssertNil(DeviceSessionVault.load())
    }
    @MainActor func testDeniedAndOversizedResponsesCannotReplaceOrForgetCredentials() async throws {
        defer { DeviceSessions.testSessionFactory = nil }
        let original = record; try DeviceSessionVault.save(original)
        for fixture in [(403,Data("{}".utf8)),(200,Data(repeating: 65, count: 64001))] {
            useFixture { _ in fixture }
            do { _ = try await DeviceSessions.renew(expectedOrigin: origin); XCTFail("Invalid response admitted") } catch {}
            do { try await DeviceSessions.disconnect(); XCTFail("Invalid disconnect admitted") } catch {}
            XCTAssertEqual(DeviceSessionVault.load(), original)
        }
        useFixture { _ in XCTFail("Wrong origin must never dispatch"); return (200,Data("{}".utf8)) }
        do { _ = try await DeviceSessions.renew(expectedOrigin: "https://other.workers.dev"); XCTFail("Wrong origin admitted") } catch {}
    }
    func testRedirectDelegateAlwaysDeniesCredentialForwarding() {
        let delegate = SessionRedirectDenial(), session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let request = URLRequest(url: URL(string: "https://elsewhere.test")!)
        let response = HTTPURLResponse(url: request.url!, statusCode: 302, httpVersion: "HTTP/1.1", headerFields: nil)!
        let task = session.dataTask(with: request); var called = false
        delegate.urlSession(session, task: task, willPerformHTTPRedirection: response, newRequest: request) { redirected in
            called = true; XCTAssertNil(redirected)
        }
        XCTAssertTrue(called)
    }
}
