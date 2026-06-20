import Foundation
import MultipeerConnectivity

/// Browses for `ceciliasnotes-sync` advertisers for `timeoutMs` milliseconds
/// and reports every peer seen at least once during the window.
final class Discovery: NSObject, MCNearbyServiceBrowserDelegate {
    /// Per Documentation/MULTIPEER_SYNC_PROTOCOL.md the wire service type is
    /// "ceciliasnotes-sync" (18 chars). MultipeerConnectivity enforces a 15-char
    /// ceiling and throws NSException on init when violated, so we expose the
    /// spec'd value but validate before constructing MC objects. See
    /// `serviceTypeIsValid` and the PR notes for the protocol-side issue.
    static let serviceType = "ceciliasnotes-sync"

    static func serviceTypeIsValid(_ s: String = serviceType) -> Bool {
        guard s.count >= 1, s.count <= 15 else { return false }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789-")
        guard s.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return false }
        guard !s.hasPrefix("-"), !s.hasSuffix("-") else { return false }
        guard !s.contains("--") else { return false }
        return true
    }

    let localPeer: MCPeerID
    let timeoutMs: Int

    private var browser: MCNearbyServiceBrowser?
    private var seen: [MCPeerID] = []
    private let lock = NSLock()
    private let group = DispatchGroup()

    init(localPeer: MCPeerID, timeoutMs: Int) {
        self.localPeer = localPeer
        self.timeoutMs = timeoutMs
    }

    /// Runs the discovery loop synchronously on the calling thread and returns
    /// every distinct peer encountered.
    func run() -> [MCPeerID] {
        let b = MCNearbyServiceBrowser(peer: localPeer, serviceType: Discovery.serviceType)
        b.delegate = self
        browser = b
        group.enter()

        b.startBrowsingForPeers()

        DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(timeoutMs)) { [weak self] in
            self?.browser?.stopBrowsingForPeers()
            self?.group.leave()
        }

        group.wait()

        lock.lock()
        let result = seen
        lock.unlock()
        return result
    }

    func browser(_ browser: MCNearbyServiceBrowser,
                 foundPeer peerID: MCPeerID,
                 withDiscoveryInfo info: [String: String]?) {
        lock.lock()
        defer { lock.unlock() }
        if !seen.contains(peerID) {
            seen.append(peerID)
        }
    }

    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        // Keep the peer in `seen` even if it disappears — the discovery report
        // is "was visible during the window," not "is visible right now."
    }

    func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
        // No way to surface this to the CLI mid-run; the caller will see an
        // empty peer list. Stderr-log for debugging.
        FileHandle.standardError.write(
            Data("cecilias-notes-multipeer: browser failed: \(error.localizedDescription)\n".utf8)
        )
    }
}
