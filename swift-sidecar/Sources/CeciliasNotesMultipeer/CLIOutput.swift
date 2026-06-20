import Foundation

/// All CLI subcommands emit a single JSON line on stdout and exit 0 unless the
/// invocation itself is malformed. Domain errors (wrong code, no peer, etc.)
/// are returned as `{"ok": false, "reason": "..."}` with exit code 0 — the
/// Node-side caller distinguishes by parsing the JSON, not by exit code.
enum CLIOutput {
    static func emit(_ object: [String: Any]) -> Never {
        if let data = try? JSONSerialization.data(withJSONObject: object, options: []),
           let line = String(data: data, encoding: .utf8) {
            FileHandle.standardOutput.write(Data((line + "\n").utf8))
        }
        exit(0)
    }

    /// Used only for argv parsing failures — invalid invocation, not a domain
    /// failure. Goes to stderr and exits non-zero.
    static func usageError(_ message: String) -> Never {
        FileHandle.standardError.write(Data(("cecilias-notes-multipeer: " + message + "\n").utf8))
        exit(64)
    }
}
