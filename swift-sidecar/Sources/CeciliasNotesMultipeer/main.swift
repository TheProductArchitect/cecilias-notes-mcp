import Foundation
import MultipeerConnectivity

// ─── argv ───────────────────────────────────────────────────────────────────

let argv = CommandLine.arguments
guard argv.count >= 2 else {
    CLIOutput.usageError(usage)
}
let subcommand = argv[1]

func flag(_ name: String) -> String? {
    if let idx = argv.firstIndex(of: "--\(name)"), idx + 1 < argv.count {
        return argv[idx + 1]
    }
    return nil
}

let localPeerName = "cecilias-notes-mcp on \(Host.current().localizedName ?? "Mac")"
let localPeer = MCPeerID(displayName: localPeerName)

/// Returns true if the MC service type is acceptable to MultipeerConnectivity
/// on this OS. If false, every MC subcommand short-circuits with a clean JSON
/// error instead of crashing inside `MCNearbyServiceBrowser.init`.
func requireValidServiceType() {
    if !Discovery.serviceTypeIsValid() {
        CLIOutput.emit([
            "ok": false,
            "reason": "service_type_invalid",
            "detail": "Service type \"\(Discovery.serviceType)\" exceeds the 15-char limit MultipeerConnectivity enforces. The iPad spec needs to be updated to a compliant value before multipeer can run on macOS."
        ])
    }
}

// ─── Subcommands ────────────────────────────────────────────────────────────

switch subcommand {

case "version":
    CLIOutput.emit(["version": "1.0.0", "service_type": Discovery.serviceType])

case "discover":
    requireValidServiceType()
    let timeout = Int(flag("timeout-ms") ?? "1500") ?? 1500
    let discovery = Discovery(localPeer: localPeer, timeoutMs: timeout)
    let peers = discovery.run()
    let pairedSet = Set(Keychain.listPeers())
    var lines: [String] = []
    for peer in peers {
        let dict: [String: Any] = [
            "peer": peer.displayName,
            "paired": pairedSet.contains(peer.displayName)
        ]
        if let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
           let line = String(data: data, encoding: .utf8) {
            lines.append(line)
        }
    }
    // NDJSON output.
    FileHandle.standardOutput.write(Data((lines.joined(separator: "\n") + "\n").utf8))
    exit(0)

case "list-paired":
    CLIOutput.emit(["peers": Keychain.listPeers()])

case "forget":
    guard let peer = flag("peer") else {
        CLIOutput.usageError("forget requires --peer <name>")
    }
    let ok = Keychain.deleteKey(peer: peer)
    CLIOutput.emit(["ok": ok])

case "pair":
    requireValidServiceType()
    guard let peer = flag("peer"), let code = flag("code") else {
        CLIOutput.usageError("pair requires --peer <name> --code <6-digits>")
    }
    let candidateKey = Crypto.deriveSharedKey(
        code: code,
        localPeer: localPeerName,
        remotePeer: peer
    )
    let runner = SessionRunner(
        localPeer: localPeer,
        targetPeerName: peer,
        action: .pair(candidateKey: candidateKey),
        storedKey: nil,
        totalTimeoutMs: 8000
    )
    let outcome = runner.run()
    switch outcome {
    case .success:
        do {
            try Keychain.storeKey(peer: peer, key: candidateKey)
            CLIOutput.emit(["ok": true, "paired": peer])
        } catch {
            CLIOutput.emit(["ok": false, "reason": "keychain_write_failed"])
        }
    case .wrongCode:
        CLIOutput.emit(["ok": false, "reason": "wrong_code"])
    case .noPairingWindow:
        CLIOutput.emit(["ok": false, "reason": "no_pairing_window"])
    case .peerUnreachable:
        CLIOutput.emit(["ok": false, "reason": "peer_unreachable"])
    case .pingTimeout:
        // Should not occur on pair flow now, but map defensively.
        CLIOutput.emit(["ok": false, "reason": "peer_unreachable"])
    case .noPeerVisible:
        CLIOutput.emit(["ok": false, "reason": "no_peer_visible"])
    case .hmacRejected:
        CLIOutput.emit(["ok": false, "reason": "hmac_rejected"])
    case .clockSkew:
        CLIOutput.emit(["ok": false, "reason": "clock_skew"])
    case .sessionFailed:
        CLIOutput.emit(["ok": false, "reason": "session_failed"])
    case .userNotPaired:
        CLIOutput.emit(["ok": false, "reason": "user_not_paired"])
    case .other(let reason):
        CLIOutput.emit(["ok": false, "reason": reason])
    }

case "send":
    requireValidServiceType()
    guard let peer = flag("peer"),
          let filePath = flag("file"),
          let filename = flag("filename") else {
        CLIOutput.usageError("send requires --peer --file --filename")
    }
    let timeout = Int(flag("timeout-ms") ?? "2000") ?? 2000

    guard let body = try? Data(contentsOf: URL(fileURLWithPath: filePath)) else {
        CLIOutput.emit(["ok": false, "reason": "file_unreadable"])
    }

    guard let storedKey = Keychain.loadKey(peer: peer) else {
        CLIOutput.emit(["ok": false, "reason": "user_not_paired"])
    }

    let runner = SessionRunner(
        localPeer: localPeer,
        targetPeerName: peer,
        action: .fileSend(filename: filename, body: body),
        storedKey: storedKey,
        totalTimeoutMs: timeout
    )

    let started = Date()
    let outcome = runner.run()
    switch outcome {
    case .success(let latencyMs):
        CLIOutput.emit([
            "ok": true,
            "peer": peer,
            "latency_ms": latencyMs > 0 ? latencyMs : Int(Date().timeIntervalSince(started) * 1000)
        ])
    case .pingTimeout:
        CLIOutput.emit(["ok": false, "reason": "ping_timeout"])
    case .peerUnreachable:
        CLIOutput.emit(["ok": false, "reason": "peer_unreachable"])
    case .wrongCode, .noPairingWindow:
        // Not reachable from file-send flow, but keep the switch exhaustive.
        CLIOutput.emit(["ok": false, "reason": outcome.jsonReason])
    case .noPeerVisible:
        CLIOutput.emit(["ok": false, "reason": "no_peer_visible"])
    case .hmacRejected:
        CLIOutput.emit(["ok": false, "reason": "hmac_rejected"])
    case .clockSkew:
        CLIOutput.emit(["ok": false, "reason": "clock_skew"])
    case .sessionFailed:
        CLIOutput.emit(["ok": false, "reason": "session_failed"])
    case .userNotPaired:
        CLIOutput.emit(["ok": false, "reason": "user_not_paired"])
    case .other(let reason):
        CLIOutput.emit(["ok": false, "reason": reason])
    }

default:
    CLIOutput.usageError(usage)
}

// ─── Usage ──────────────────────────────────────────────────────────────────

var usage: String {
    """
    Usage:
      cecilias-notes-multipeer version
      cecilias-notes-multipeer discover [--timeout-ms <n>]
      cecilias-notes-multipeer list-paired
      cecilias-notes-multipeer pair --peer <name> --code <6-digits>
      cecilias-notes-multipeer send --peer <name> --file <path> --filename <name> [--timeout-ms <n>]
      cecilias-notes-multipeer forget --peer <name>
    """
}
