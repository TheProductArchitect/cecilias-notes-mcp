import Foundation
import CryptoKit

/// Crypto helpers shared between pairing, ping/pong, and file sends.
///
/// Inputs (HKDF salt, info string format) are locked by the wire protocol
/// (Documentation/MULTIPEER_SYNC_PROTOCOL.md). Do not change without bumping
/// the service type.
enum Crypto {
    static let hkdfSalt = "ceciliasnotes.multipeer.v1.salt"

    /// HKDF-SHA256 over the 6-digit code, with the salt + info string the spec
    /// mandates. `localPeer` is whichever side is calling; `remotePeer` is
    /// the other side. The roles must mirror on the iPad for the keys to match.
    static func deriveSharedKey(
        code: String,
        localPeer: String,
        remotePeer: String
    ) -> SymmetricKey {
        let inputKey = SymmetricKey(data: Data(code.utf8))
        let salt = Data(hkdfSalt.utf8)
        let info = Data("\(localPeer)|\(remotePeer)".utf8)
        return HKDF<SHA256>.deriveKey(
            inputKeyMaterial: inputKey,
            salt: salt,
            info: info,
            outputByteCount: 32
        )
    }

    static func hmac(headerJSON: Data, body: Data, key: SymmetricKey) -> Data {
        var message = headerJSON
        message.append(body)
        return Data(HMAC<SHA256>.authenticationCode(for: message, using: key))
    }

    static func verifyHMAC(_ tag: Data, headerJSON: Data, body: Data, key: SymmetricKey) -> Bool {
        var message = headerJSON
        message.append(body)
        return HMAC<SHA256>.isValidAuthenticationCode(tag, authenticating: message, using: key)
    }

    static func randomNonceBase64() -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        precondition(status == errSecSuccess, "SecRandomCopyBytes failed")
        return Data(bytes).base64EncodedString()
    }

    /// Convert a `SymmetricKey` to raw bytes for Keychain storage.
    static func keyBytes(_ key: SymmetricKey) -> Data {
        return key.withUnsafeBytes { Data($0) }
    }
}
