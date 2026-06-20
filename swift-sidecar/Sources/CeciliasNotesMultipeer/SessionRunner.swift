import Foundation
import MultipeerConnectivity
import CryptoKit

/// Drives one outbound session: browse → invite → connect → ping → wait pong
/// → optional file send → disconnect. Returns a `Result` describing what
/// happened so the CLI can serialise it to JSON.
final class SessionRunner: NSObject,
                           MCSessionDelegate,
                           MCNearbyServiceBrowserDelegate {
    enum Outcome {
        case success(latencyMs: Int)
        case pingTimeout
        case peerUnreachable        // pairing analogue of pingTimeout
        case wrongCode              // pairing-result: wrong_code
        case noPairingWindow        // pairing-result: no_pairing_window
        case sessionFailed
        case noPeerVisible
        case hmacRejected
        case clockSkew
        case userNotPaired
        case other(String)

        var jsonReason: String {
            switch self {
            case .success: return "ok"
            case .pingTimeout: return "ping_timeout"
            case .peerUnreachable: return "peer_unreachable"
            case .wrongCode: return "wrong_code"
            case .noPairingWindow: return "no_pairing_window"
            case .sessionFailed: return "session_failed"
            case .noPeerVisible: return "no_peer_visible"
            case .hmacRejected: return "hmac_rejected"
            case .clockSkew: return "clock_skew"
            case .userNotPaired: return "user_not_paired"
            case .other(let reason): return reason
            }
        }
    }

    /// What the runner is trying to do once the session is up.
    enum Action {
        case ping
        case pair(candidateKey: SymmetricKey)
        case fileSend(filename: String, body: Data)
    }

    let localPeer: MCPeerID
    let targetPeerName: String
    let action: Action
    let storedKey: SymmetricKey?
    let totalTimeoutMs: Int

    private var session: MCSession?
    private var browser: MCNearbyServiceBrowser?
    private var resolvedPeerID: MCPeerID?
    private var pingSentAt: Date?

    private var outcome: Outcome = .other("internal_error")
    private let completion = DispatchSemaphore(value: 0)
    private var completed = false

    /// Effective HMAC key for ping/pong/file/pairing-result(ok): candidate
    /// during the pairing flow, stored shared key otherwise. The unsigned-hint
    /// pairing-result messages do not need this key.
    private var effectiveKey: SymmetricKey? {
        if case let .pair(candidateKey) = action {
            return candidateKey
        }
        return storedKey
    }

    init(localPeer: MCPeerID,
         targetPeerName: String,
         action: Action,
         storedKey: SymmetricKey?,
         totalTimeoutMs: Int) {
        self.localPeer = localPeer
        self.targetPeerName = targetPeerName
        self.action = action
        self.storedKey = storedKey
        self.totalTimeoutMs = totalTimeoutMs
    }

    /// Synchronously runs the flow and returns the result.
    func run() -> Outcome {
        let session = MCSession(peer: localPeer,
                                securityIdentity: nil,
                                encryptionPreference: .required)
        session.delegate = self
        self.session = session

        let browser = MCNearbyServiceBrowser(peer: localPeer,
                                             serviceType: Discovery.serviceType)
        browser.delegate = self
        self.browser = browser
        browser.startBrowsingForPeers()

        // Total ceiling — if we don't find the peer, can't connect, never see
        // a pong, etc., we bail out within this budget.
        DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(totalTimeoutMs)) { [weak self] in
            self?.finishIfNeeded(.other("timeout"))
        }

        completion.wait()
        browser.stopBrowsingForPeers()
        session.disconnect()
        return outcome
    }

    // MARK: - Browser

    func browser(_ browser: MCNearbyServiceBrowser,
                 foundPeer peerID: MCPeerID,
                 withDiscoveryInfo info: [String: String]?) {
        guard peerID.displayName == targetPeerName, resolvedPeerID == nil else { return }
        resolvedPeerID = peerID
        guard let session = session else { return }
        browser.invitePeer(peerID, to: session, withContext: nil, timeout: 5)
    }

    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {}

    func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
        finishIfNeeded(.sessionFailed)
    }

    // MARK: - Session

    func session(_ session: MCSession,
                 peer peerID: MCPeerID,
                 didChange state: MCSessionState) {
        switch state {
        case .connected:
            // Connected — send the appropriate first payload.
            switch action {
            case .ping, .fileSend:
                guard let key = effectiveKey else {
                    finishIfNeeded(.userNotPaired)
                    return
                }
                sendPing(to: peerID, key: key)

            case .pair(let candidateKey):
                sendPairingHello(to: peerID, key: candidateKey)
            }

        case .notConnected:
            // If we haven't completed yet, MC dropped the session.
            finishIfNeeded(.sessionFailed)

        case .connecting:
            break

        @unknown default:
            break
        }
    }

    func session(_ session: MCSession,
                 didReceive data: Data,
                 fromPeer peerID: MCPeerID) {
        handleIncoming(data, from: peerID)
    }

    func session(_ session: MCSession,
                 didReceive stream: InputStream,
                 withName streamName: String,
                 fromPeer peerID: MCPeerID) {}

    func session(_ session: MCSession,
                 didStartReceivingResourceWithName resourceName: String,
                 fromPeer peerID: MCPeerID,
                 with progress: Progress) {}

    func session(_ session: MCSession,
                 didFinishReceivingResourceWithName resourceName: String,
                 fromPeer peerID: MCPeerID,
                 at localURL: URL?,
                 withError error: Error?) {}

    // MARK: - Sends

    private func sendPing(to peer: MCPeerID, key: SymmetricKey) {
        let blob = Payload.build(type: .ping, key: key)
        pingSentAt = Date()
        do {
            try session?.send(blob, toPeers: [peer], with: .reliable)
        } catch {
            finishIfNeeded(.sessionFailed)
            return
        }
        // 500ms pong window per spec.
        DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(500)) { [weak self] in
            self?.finishIfNeeded(.pingTimeout)
        }
    }

    private func sendPairingHello(to peer: MCPeerID, key: SymmetricKey) {
        let blob = Payload.build(type: .pairingHello, key: key)
        do {
            try session?.send(blob, toPeers: [peer], with: .reliable)
        } catch {
            finishIfNeeded(.sessionFailed)
            return
        }
        // The iPad replies with a `pairing-result` message (v2.1). 2-second
        // window covers a slow Bluetooth handshake; the protocol's typical
        // latency is well under 100ms.
        DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(2000)) { [weak self] in
            self?.finishIfNeeded(.peerUnreachable)
        }
    }

    private func sendFile(to peer: MCPeerID, key: SymmetricKey, filename: String, body: Data) {
        let blob = Payload.build(type: .file, body: body, filename: filename, key: key)
        do {
            try session?.send(blob, toPeers: [peer], with: .reliable)
            let latency = pingSentAt.map { Int(Date().timeIntervalSince($0) * 1000) } ?? 0
            finishIfNeeded(.success(latencyMs: latency))
        } catch {
            finishIfNeeded(.sessionFailed)
        }
    }

    // MARK: - Receive

    private func handleIncoming(_ data: Data, from peerID: MCPeerID) {
        guard let parsed = try? Payload.parse(data) else { return }
        guard let typeStr = parsed.header["type"] as? String,
              let type = PayloadType(rawValue: typeStr) else { return }

        // For the pairing-result hint cases the iPad sends a 32-byte all-zero
        // HMAC by convention ("unsigned hint"). We accept those without key
        // verification — an attacker can only force a retry, not a compromise.
        // The success path is fully authenticated below.
        if type == .pairingResult {
            handlePairingResult(parsed.header, tag: parsed.tag, body: parsed.body)
            return
        }

        guard let key = effectiveKey else { return }

        // Verify HMAC with whichever key we expect.
        let canonicalHeader = (try? JSONSerialization.data(
            withJSONObject: parsed.header, options: [.sortedKeys]
        )) ?? Data()
        guard Crypto.verifyHMAC(parsed.tag, headerJSON: canonicalHeader, body: parsed.body, key: key) else {
            finishIfNeeded(.hmacRejected)
            return
        }

        if type == .pong {
            // Only the file-send and bare-ping flows wait on pongs now. The
            // pair flow waits on pairing-result.
            switch action {
            case .fileSend(let filename, let body):
                guard let resolved = resolvedPeerID else {
                    finishIfNeeded(.sessionFailed)
                    return
                }
                sendFile(to: resolved, key: key, filename: filename, body: body)

            case .ping:
                let latency = pingSentAt.map { Int(Date().timeIntervalSince($0) * 1000) } ?? 0
                finishIfNeeded(.success(latencyMs: latency))

            case .pair:
                // Unexpected — iPad shouldn't pong before pairing-result. Ignore.
                break
            }
        }
    }

    /// Dispatch the v2.1 `pairing-result` reply:
    ///   - result: "ok"               → HMAC must verify with candidate key
    ///   - result: "wrong_code"       → unsigned hint (32-byte all-zero HMAC)
    ///   - result: "no_pairing_window"→ unsigned hint (32-byte all-zero HMAC)
    private func handlePairingResult(_ header: [String: Any], tag: Data, body: Data) {
        guard case let .pair(candidateKey) = action else { return }
        guard let result = header["result"] as? String else {
            finishIfNeeded(.other("malformed_pairing_result"))
            return
        }

        switch result {
        case "ok":
            // MUST verify before treating pairing as confirmed.
            let canonicalHeader = (try? JSONSerialization.data(
                withJSONObject: header, options: [.sortedKeys]
            )) ?? Data()
            if Crypto.verifyHMAC(tag, headerJSON: canonicalHeader, body: body, key: candidateKey) {
                let latency = pingSentAt.map { Int(Date().timeIntervalSince($0) * 1000) } ?? 0
                finishIfNeeded(.success(latencyMs: latency))
            } else {
                finishIfNeeded(.hmacRejected)
            }

        case "wrong_code":
            // Unsigned hint — UI signal only; an attacker forging it can only
            // cause the user to retry. We don't enforce the zero-HMAC convention
            // strictly (any HMAC works as a hint) but we do log when it's
            // anomalously non-zero so a real attack is at least visible.
            if tag != unsignedHintHMAC {
                FileHandle.standardError.write(
                    Data("cecilias-notes-multipeer: wrong_code hint had non-zero HMAC (possible spoof)\n".utf8)
                )
            }
            finishIfNeeded(.wrongCode)

        case "no_pairing_window":
            if tag != unsignedHintHMAC {
                FileHandle.standardError.write(
                    Data("cecilias-notes-multipeer: no_pairing_window hint had non-zero HMAC (possible spoof)\n".utf8)
                )
            }
            finishIfNeeded(.noPairingWindow)

        default:
            finishIfNeeded(.other("unknown_pairing_result:\(result)"))
        }
    }

    // MARK: - Completion

    private func finishIfNeeded(_ outcome: Outcome) {
        objc_sync_enter(self)
        defer { objc_sync_exit(self) }
        guard !completed else { return }
        completed = true
        self.outcome = outcome
        completion.signal()
    }
}
