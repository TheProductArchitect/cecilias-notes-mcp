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
        case pairingHelloThenPing(candidateKey: SymmetricKey)
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

    /// Effective HMAC key for ping/pong/file: candidate during pairing flow,
    /// stored otherwise.
    private var effectiveKey: SymmetricKey? {
        if case let .pairingHelloThenPing(candidateKey) = action {
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

            case .pairingHelloThenPing(let candidateKey):
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
        // After pairing-hello, immediately probe with a ping HMAC'd with the
        // candidate key. A successful pong proves the iPad accepted the
        // pairing and stored the same key.
        sendPing(to: peer, key: key)
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
        guard let key = effectiveKey else { return }
        guard let parsed = try? Payload.parse(data) else { return }
        guard let typeStr = parsed.header["type"] as? String,
              let type = PayloadType(rawValue: typeStr) else { return }

        // Verify HMAC with whichever key we expect.
        if !Crypto.verifyHMAC(parsed.tag,
                              headerJSON: try! JSONSerialization.data(
                                  withJSONObject: parsed.header, options: [.sortedKeys]
                              ),
                              body: parsed.body,
                              key: key) {
            finishIfNeeded(.hmacRejected)
            return
        }

        if type == .pong {
            // Pong: either the session is now alive (file-send action) or the
            // pairing flow has confirmed the candidate key (pairing action).
            switch action {
            case .fileSend(let filename, let body):
                guard let resolved = resolvedPeerID else {
                    finishIfNeeded(.sessionFailed)
                    return
                }
                sendFile(to: resolved, key: key, filename: filename, body: body)

            case .pairingHelloThenPing, .ping:
                let latency = pingSentAt.map { Int(Date().timeIntervalSince($0) * 1000) } ?? 0
                finishIfNeeded(.success(latencyMs: latency))
            }
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
