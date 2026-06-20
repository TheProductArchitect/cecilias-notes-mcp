import Foundation
import CryptoKit

/// On-wire payload layout per Documentation/MULTIPEER_SYNC_PROTOCOL.md (v2):
///
///   [4 byte BE length][header JSON][32 byte HMAC][body]
///
/// HMAC-SHA256 is over `headerJSON || body`. The body is empty for
/// pairing-hello / ping / pong.
enum PayloadType: String {
    case file = "file"
    case pairingHello = "pairing-hello"
    case ping = "ping"
    case pong = "pong"
}

struct PayloadHeader {
    let type: PayloadType
    let filename: String?
    let timestamp: Int
    let nonce: String

    func toJSON() -> Data {
        var dict: [String: Any] = [
            "type": type.rawValue,
            "timestamp": timestamp,
            "nonce": nonce
        ]
        if let filename = filename {
            dict["filename"] = filename
        }
        return try! JSONSerialization.data(
            withJSONObject: dict,
            options: [.sortedKeys]
        )
    }
}

enum Payload {
    /// Build an outgoing payload blob signed with `key`.
    static func build(
        type: PayloadType,
        body: Data = Data(),
        filename: String? = nil,
        key: SymmetricKey
    ) -> Data {
        let header = PayloadHeader(
            type: type,
            filename: filename,
            timestamp: Int(Date().timeIntervalSince1970),
            nonce: Crypto.randomNonceBase64()
        )
        let headerJSON = header.toJSON()
        let tag = Crypto.hmac(headerJSON: headerJSON, body: body, key: key)

        var blob = Data()
        var len = UInt32(headerJSON.count).bigEndian
        blob.append(Data(bytes: &len, count: 4))
        blob.append(headerJSON)
        blob.append(tag)
        blob.append(body)
        return blob
    }

    enum ParseError: Error {
        case tooShort
        case badHeader
        case unknownType(String)
    }

    /// Parse an incoming blob and return (header dict, tag, body) WITHOUT
    /// verifying the HMAC — the caller verifies because it knows which key
    /// applies (per-peer for ping/pong/file, candidate for pairing-hello).
    static func parse(_ blob: Data) throws -> (header: [String: Any], tag: Data, body: Data) {
        guard blob.count >= 4 else { throw ParseError.tooShort }
        let headerLen = Int(
            UInt32(blob[0]) << 24 |
            UInt32(blob[1]) << 16 |
            UInt32(blob[2]) << 8  |
            UInt32(blob[3])
        )
        guard blob.count >= 4 + headerLen + 32 else { throw ParseError.tooShort }

        let headerData = blob.subdata(in: 4 ..< 4 + headerLen)
        let tag = blob.subdata(in: 4 + headerLen ..< 4 + headerLen + 32)
        let body = blob.subdata(in: 4 + headerLen + 32 ..< blob.count)

        guard let any = try JSONSerialization.jsonObject(with: headerData) as? [String: Any] else {
            throw ParseError.badHeader
        }
        return (any, tag, body)
    }
}
