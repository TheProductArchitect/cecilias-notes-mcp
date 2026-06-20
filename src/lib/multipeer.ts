import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawn } from 'child_process'

/**
 * Best-effort multipeer delivery via the cecilias-notes-multipeer Swift
 * sidecar. Every code path here is designed to never throw — the iCloud
 * Inbox write is the durable record; multipeer is a latency accelerator,
 * not a fallible critical path.
 */

export type DeliveryFallbackReason =
  | 'multipeer_disabled'
  | 'sidecar_unavailable'
  | 'no_peer_visible'
  | 'ping_timeout'
  | 'session_failed'
  | 'user_not_paired'
  | 'hmac_rejected'
  | 'clock_skew'
  | 'service_type_invalid'
  | 'sidecar_error'

export type DeliveryResult =
  | { transport: 'multipeer'; peer: string; latency_ms: number }
  | {
      transport: 'icloud'
      fallback_reason: DeliveryFallbackReason
      estimated_latency_seconds: [number, number]
      detail?: string
    }

const ICLOUD_LATENCY: [number, number] = [30, 300]

function sidecarPath(): string | null {
  if (process.env.CECILIAS_NOTES_SIDECAR_PATH) {
    return process.env.CECILIAS_NOTES_SIDECAR_PATH
  }
  // Resolved from the compiled dist/lib/ path → ../../bin/cecilias-notes-multipeer
  const candidate = path.join(__dirname, '..', '..', 'bin', 'cecilias-notes-multipeer')
  return fs.existsSync(candidate) ? candidate : null
}

function multipeerDisabled(): boolean {
  return process.env.CECILIAS_NOTES_DISABLE_MULTIPEER === '1' ||
         process.env.CECILIAS_NOTES_DISABLE_MULTIPEER === 'true'
}

interface CliResult {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
}

async function runSidecar(binPath: string, args: string[], timeoutMs: number): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(binPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGKILL') } catch {}
    }, timeoutMs)

    child.stdout.on('data', d => { stdout += d.toString('utf8') })
    child.stderr.on('data', d => { stderr += d.toString('utf8') })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code, timedOut })
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: -1, timedOut })
    })
  })
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try { return JSON.parse(line) as Record<string, unknown> } catch { return null }
}

function parseNdjson(text: string): Array<Record<string, unknown>> {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(parseJsonLine)
    .filter((x): x is Record<string, unknown> => x !== null)
}

export async function discoverPeers(timeoutMs = 1500): Promise<{
  peers: Array<{ peer: string; paired: boolean }>
  fallback?: DeliveryFallbackReason
  detail?: string
}> {
  if (multipeerDisabled()) return { peers: [], fallback: 'multipeer_disabled' }
  const bin = sidecarPath()
  if (!bin) return { peers: [], fallback: 'sidecar_unavailable' }

  const result = await runSidecar(bin, ['discover', '--timeout-ms', String(timeoutMs)], timeoutMs + 1500)
  if (result.exitCode !== 0) {
    return { peers: [], fallback: 'sidecar_error' }
  }
  const rows = parseNdjson(result.stdout)
  // The validation error path emits a single non-NDJSON object; detect it.
  if (rows.length === 1 && rows[0].ok === false && typeof rows[0].reason === 'string') {
    return {
      peers: [],
      fallback: rows[0].reason as DeliveryFallbackReason,
      detail: typeof rows[0].detail === 'string' ? rows[0].detail : undefined
    }
  }
  const peers = rows
    .filter(r => typeof r.peer === 'string')
    .map(r => ({ peer: r.peer as string, paired: r.paired === true }))
  return { peers }
}

export async function listPairedPeers(): Promise<string[]> {
  if (multipeerDisabled()) return []
  const bin = sidecarPath()
  if (!bin) return []
  const result = await runSidecar(bin, ['list-paired'], 5000)
  if (result.exitCode !== 0) return []
  const parsed = parseJsonLine(result.stdout.trim())
  return Array.isArray(parsed?.peers) ? (parsed!.peers as string[]) : []
}

export async function pairPeer(peer: string, code: string): Promise<{ ok: true; peer: string } | { ok: false; reason: string; detail?: string }> {
  if (multipeerDisabled()) return { ok: false, reason: 'multipeer_disabled' }
  const bin = sidecarPath()
  if (!bin) return { ok: false, reason: 'sidecar_unavailable' }

  const result = await runSidecar(bin, ['pair', '--peer', peer, '--code', code], 12000)
  const parsed = parseJsonLine(result.stdout.trim())
  if (!parsed) return { ok: false, reason: 'sidecar_error' }
  if (parsed.ok === true) return { ok: true, peer }
  return {
    ok: false,
    reason: typeof parsed.reason === 'string' ? parsed.reason : 'sidecar_error',
    detail: typeof parsed.detail === 'string' ? parsed.detail : undefined
  }
}

export async function forgetPeer(peer: string): Promise<boolean> {
  if (multipeerDisabled()) return false
  const bin = sidecarPath()
  if (!bin) return false
  const result = await runSidecar(bin, ['forget', '--peer', peer], 5000)
  const parsed = parseJsonLine(result.stdout.trim())
  return parsed?.ok === true
}

/**
 * Best-effort multipeer file delivery. Returns null on success (caller uses
 * the success payload for the response), or a DeliveryResult with
 * transport:"icloud" describing why we fell back so the caller can pass it
 * through verbatim.
 */
export async function tryDeliverViaMultipeer(args: {
  fileBytes: Buffer
  filename: string
  budgetMs?: number
}): Promise<DeliveryResult> {
  const budgetMs = args.budgetMs ?? 2000

  if (multipeerDisabled()) {
    return {
      transport: 'icloud',
      fallback_reason: 'multipeer_disabled',
      estimated_latency_seconds: ICLOUD_LATENCY
    }
  }
  const bin = sidecarPath()
  if (!bin) {
    return {
      transport: 'icloud',
      fallback_reason: 'sidecar_unavailable',
      estimated_latency_seconds: ICLOUD_LATENCY
    }
  }

  // Discover phase — 500ms of the budget.
  const discoverMs = Math.min(500, Math.floor(budgetMs / 4))
  const discovery = await discoverPeers(discoverMs)
  if (discovery.fallback) {
    return {
      transport: 'icloud',
      fallback_reason: discovery.fallback,
      estimated_latency_seconds: ICLOUD_LATENCY,
      detail: discovery.detail
    }
  }
  const paired = discovery.peers.filter(p => p.paired)
  if (paired.length === 0) {
    return {
      transport: 'icloud',
      fallback_reason: discovery.peers.length > 0 ? 'user_not_paired' : 'no_peer_visible',
      estimated_latency_seconds: ICLOUD_LATENCY
    }
  }

  // Pick the first paired peer (most-recently-paired per spec — we treat
  // sidecar order as authoritative since the iPad uses display-name keys).
  const target = paired[0]

  // Drop file bytes to a temp path because the sidecar reads from disk.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cecilias-notes-mcp-send-'))
  const tmpPath = path.join(tmpDir, args.filename)
  try {
    fs.writeFileSync(tmpPath, args.fileBytes)
    const sendBudget = Math.max(budgetMs - discoverMs, 500)
    const result = await runSidecar(bin, [
      'send',
      '--peer', target.peer,
      '--file', tmpPath,
      '--filename', args.filename,
      '--timeout-ms', String(sendBudget)
    ], sendBudget + 2000)
    const parsed = parseJsonLine(result.stdout.trim())
    if (parsed?.ok === true) {
      return {
        transport: 'multipeer',
        peer: target.peer,
        latency_ms: typeof parsed.latency_ms === 'number' ? parsed.latency_ms : 0
      }
    }
    const reason = (typeof parsed?.reason === 'string' ? parsed.reason : 'sidecar_error') as DeliveryFallbackReason
    return {
      transport: 'icloud',
      fallback_reason: reason,
      estimated_latency_seconds: ICLOUD_LATENCY
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}
