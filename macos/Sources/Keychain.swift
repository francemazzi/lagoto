import Foundation
import Security

enum CredentialStore {
    private static func query(_ profileID: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "org.frasma.lagoto.profile", kSecAttrAccount as String: profileID]
    }
    static func save(_ secret: String, profileID: String) throws {
        var item = query(profileID)
        let data = Data(secret.utf8)
        let updated = SecItemUpdate(item as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if updated == errSecItemNotFound {
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            try check(SecItemAdd(item as CFDictionary, nil))
        } else { try check(updated) }
    }
    static func read(profileID: String) throws -> String? {
        var item = query(profileID)
        item[kSecReturnData as String] = true
        item[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(item as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        try check(status)
        guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else { throw RPCError(code: -1, message: "Credenziale Keychain non leggibile") }
        return value
    }
    static func remove(profileID: String) throws {
        let status = SecItemDelete(query(profileID) as CFDictionary)
        if status != errSecItemNotFound { try check(status) }
    }
    private static func check(_ status: OSStatus) throws {
        guard status == errSecSuccess else { throw RPCError(code: Int(status), message: SecCopyErrorMessageString(status, nil) as String? ?? "Keychain non disponibile") }
    }
}
