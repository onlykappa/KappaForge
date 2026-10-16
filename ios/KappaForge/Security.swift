import SwiftUI
import LocalAuthentication
import Security

// Preserve the bundle identifier and WebKit data store across upgrades.
enum CredentialVault {
    static let service = "com.onlykappa.KappaForge.backend"
    static func load() -> [String: String]? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "owner",
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return try? JSONDecoder().decode([String: String].self, from: data)
    }
    @discardableResult static func save(_ value: [String: String]) -> Bool {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "owner"]
        if value["access", default: ""].isEmpty {
            let status = SecItemDelete(query as CFDictionary)
            return status == errSecSuccess || status == errSecItemNotFound
        }
        guard let data = try? JSONEncoder().encode(value) else { return false }
        let attributes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            return SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil) == errSecSuccess
        }
        return status == errSecSuccess
    }
}

@MainActor final class AppSecurity: ObservableObject {
    @Published var unlocked = !UserDefaults.standard.bool(forKey: "kappa.biometricLock")
    @Published var message = ""
    @Published var authenticating = false
    @Published var enabled = UserDefaults.standard.bool(forKey: "kappa.biometricLock")
    private var context: LAContext?
    func lock() {
        guard enabled else { return }
        context?.invalidate(); context = nil; authenticating = false; unlocked = false
    }
    func authenticate(enabling: Bool = false) {
        guard !authenticating else { return }
        let attempt = LAContext(); var error: NSError?
        // Require enrolled biometrics to enable; device passcode is a recovery fallback.
        guard attempt.canEvaluatePolicy(enabling ? .deviceOwnerAuthenticationWithBiometrics : .deviceOwnerAuthentication, error: &error) else {
            message = error?.localizedDescription ?? "Device authentication unavailable."
            return
        }
        context = attempt; authenticating = true; message = ""
        attempt.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock your KappaForge assistant") { [weak self] success, error in
            Task { @MainActor in
                guard let self, self.context === attempt else { return }
                self.context = nil; self.authenticating = false
                if success {
                    self.unlocked = true
                    if enabling { self.enabled = true; UserDefaults.standard.set(true, forKey: "kappa.biometricLock") }
                } else { self.message = error?.localizedDescription ?? "Authentication was not completed." }
            }
        }
    }
    func disable() { guard unlocked else { return }; enabled = false; UserDefaults.standard.set(false, forKey: "kappa.biometricLock") }
}
