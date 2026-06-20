import Foundation
import Security
import CryptoKit

/// macOS Keychain wrapper for per-peer multipeer shared keys.
///
/// Attributes are locked by the hand-off brief — must mirror the iPad side
/// so future cross-device debugging stays sane:
///   service       = "app.ceciliasnotes.multipeer.sharedKey"
///   account       = the iPad's MCPeerID.displayName
///   accessible    = AfterFirstUnlockThisDeviceOnly
///   synchronizable = false (no iCloud Keychain)
enum Keychain {
    static let service = "app.ceciliasnotes.multipeer.sharedKey"

    enum KeychainError: Error {
        case osStatus(OSStatus)
    }

    static func storeKey(peer: String, key: SymmetricKey) throws {
        let data = Crypto.keyBytes(key)
        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: peer,
            kSecAttrSynchronizable as String: false
        ]

        // SecItemUpdate refuses if the item doesn't exist; try add first,
        // then update on duplicate.
        var addQuery = baseQuery
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        switch addStatus {
        case errSecSuccess:
            return
        case errSecDuplicateItem:
            let updateStatus = SecItemUpdate(
                baseQuery as CFDictionary,
                [kSecValueData as String: data] as CFDictionary
            )
            if updateStatus != errSecSuccess {
                throw KeychainError.osStatus(updateStatus)
            }
        default:
            throw KeychainError.osStatus(addStatus)
        }
    }

    static func loadKey(peer: String) -> SymmetricKey? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: peer,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return SymmetricKey(data: data)
    }

    @discardableResult
    static func deleteKey(peer: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: peer
        ]
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    static func listPeers() -> [String] {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let array = item as? [[String: Any]] else { return [] }
        return array.compactMap { $0[kSecAttrAccount as String] as? String }.sorted()
    }
}
