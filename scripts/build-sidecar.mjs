#!/usr/bin/env node
// Builds the cecilias-notes-multipeer Swift sidecar and copies the universal
// binary into bin/. Run automatically by `npm postinstall` on darwin; a no-op
// on every other OS so non-mac installs (including npm's lockfile updates and
// CI) don't fail.
import { execSync } from 'node:child_process'
import { mkdirSync, copyFileSync, chmodSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const sidecarDir = join(root, 'swift-sidecar')
const binDir = join(root, 'bin')

function warn(message) {
  process.stderr.write(`cecilias-notes-mcp: ${message}\n`)
}

if (process.platform !== 'darwin') {
  warn('skipping multipeer sidecar build (non-darwin platform). The package will work via iCloud only.')
  process.exit(0)
}

if (!existsSync(sidecarDir)) {
  // Tarballs without the swift-sidecar/ tree (older versions, or trimmed
  // installs) still work — multipeer just stays disabled.
  warn('swift-sidecar/ not present in this install; multipeer will be disabled.')
  process.exit(0)
}

try {
  execSync('xcode-select -p', { stdio: 'ignore' })
} catch {
  warn('Xcode Command Line Tools not installed — skipping multipeer sidecar build.')
  warn('Install with: xcode-select --install. Multipeer will be disabled until then; iCloud delivery still works.')
  process.exit(0)
}

try {
  execSync('swift --version', { stdio: 'ignore' })
} catch {
  warn('swift not found on PATH — skipping multipeer sidecar build.')
  process.exit(0)
}

try {
  execSync(
    'swift build -c release --arch arm64 --arch x86_64',
    { cwd: sidecarDir, stdio: 'inherit' }
  )
} catch (err) {
  // Try arch-native build as fallback (e.g. if the universal slice flag set
  // isn't supported on the user's swift toolchain).
  warn('universal build failed; falling back to native-arch build')
  try {
    execSync('swift build -c release', { cwd: sidecarDir, stdio: 'inherit' })
  } catch {
    warn('multipeer sidecar build failed — falling back to iCloud-only delivery.')
    process.exit(0)
  }
}

mkdirSync(binDir, { recursive: true })

const candidates = [
  join(sidecarDir, '.build', 'apple', 'Products', 'Release', 'cecilias-notes-multipeer'),
  join(sidecarDir, '.build', 'release', 'cecilias-notes-multipeer')
]
const built = candidates.find(p => existsSync(p))
if (!built) {
  warn('built sidecar binary not found at expected paths; multipeer will be disabled.')
  process.exit(0)
}

const target = join(binDir, 'cecilias-notes-multipeer')
copyFileSync(built, target)
chmodSync(target, 0o755)
process.stderr.write(`cecilias-notes-mcp: multipeer sidecar installed at ${target}\n`)
