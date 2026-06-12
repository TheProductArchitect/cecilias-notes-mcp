import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'

const CONTAINER = 'iCloud~app~ceciliasnotes'

export const CONTAINER_ROOT = path.join(
  os.homedir(),
  'Library',
  'Mobile Documents',
  CONTAINER,
  'Documents'
)

export const INBOX_ROOT = path.join(CONTAINER_ROOT, 'Inbox')
export const MCP_NOTEBOOKS_ROOT = path.join(CONTAINER_ROOT, 'MCP', 'notebooks')

export function iCloudAvailable(): boolean {
  return process.platform === 'darwin' && fs.existsSync(CONTAINER_ROOT)
}

export const ICLOUD_MISSING_MESSAGE =
  'Cecilia\'s Notes iCloud container not found.\n\n' +
  'Please ensure:\n' +
  '  1. You are on macOS with iCloud Drive enabled\n' +
  '  2. Cecilia\'s Notes is installed on your iPad and signed in to the same Apple ID\n' +
  '  3. iCloud Drive has had time to sync at least once\n\n' +
  `Expected path: ${CONTAINER_ROOT}`

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function requireIcloud(): void {
  if (!iCloudAvailable()) {
    throw new Error(ICLOUD_MISSING_MESSAGE)
  }
}

export function getInboxRoot(): string {
  requireIcloud()
  ensureDir(INBOX_ROOT)
  return INBOX_ROOT
}

export function getMcpNotebooksRoot(): string {
  requireIcloud()
  ensureDir(MCP_NOTEBOOKS_ROOT)
  return MCP_NOTEBOOKS_ROOT
}

/**
 * Returns the path of an existing mirror file matching `notebookId`
 * case-insensitively (Swift's UUID().uuidString is uppercase, ours is lowercase;
 * on case-sensitive volumes a direct join misses).
 * Returns the lowercase-keyed path even if the file doesn't exist yet.
 */
export function getMcpNotebookPath(notebookId: string): string {
  const root = getMcpNotebooksRoot()
  const direct = path.join(root, `${notebookId}.inkbook`)
  if (fs.existsSync(direct)) return direct
  const wanted = `${notebookId}.inkbook`.toLowerCase()
  try {
    for (const entry of fs.readdirSync(root)) {
      if (entry.toLowerCase() === wanted) return path.join(root, entry)
    }
  } catch {}
  return direct
}

/**
 * Fallback to find a notebook the app hasn't mirrored yet — scan Inbox for a
 * file whose top-level `id` matches the requested id (case-insensitive).
 */
export function findInboxNotebookById(notebookId: string): string | null {
  let inbox: string
  try { inbox = getInboxRoot() } catch { return null }
  const wantedId = notebookId.toLowerCase()
  const wantedName = `${notebookId}.inkbook`.toLowerCase()
  let entries: string[]
  try { entries = fs.readdirSync(inbox) } catch { return null }
  for (const entry of entries) {
    if (!entry.endsWith('.inkbook')) continue
    const full = path.join(inbox, entry)
    if (entry.toLowerCase() === wantedName) return full
    try {
      const raw = fs.readFileSync(full, 'utf-8')
      const parsed = JSON.parse(raw)
      if (typeof parsed?.id === 'string' && parsed.id.toLowerCase() === wantedId) {
        return full
      }
    } catch {}
  }
  return null
}

export function getInboxNotebookPath(notebookId: string): string {
  return path.join(getInboxRoot(), `${notebookId}.inkbook`)
}

export function getInboxRequestPath(filename: string): string {
  return path.join(getInboxRoot(), filename)
}

export function getUniqueInboxTitlePath(title: string): string {
  const inbox = getInboxRoot()
  const base = sanitizeFilename(title) || 'Untitled'
  let candidate = path.join(inbox, `${base}.inkbook`)
  let n = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(inbox, `${base} (${n}).inkbook`)
    n++
  }
  return candidate
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[/:*?"<>|\\]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .substring(0, 100)
}
