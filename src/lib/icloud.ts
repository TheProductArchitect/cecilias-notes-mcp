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

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function requireContainer(): void {
  if (!iCloudAvailable()) {
    throw new Error(
      'Cecilia\'s Notes iCloud container not found.\n\n' +
      'Please ensure:\n' +
      '  1. You are on macOS with iCloud Drive enabled\n' +
      '  2. Cecilia\'s Notes is installed on your iPad and signed in to the same Apple ID\n' +
      '  3. iCloud Drive has had time to sync at least once\n\n' +
      `Expected path: ${CONTAINER_ROOT}`
    )
  }
}

export function getInboxRoot(): string {
  requireContainer()
  ensureDir(INBOX_ROOT)
  return INBOX_ROOT
}

export function getMcpNotebooksRoot(): string {
  requireContainer()
  ensureDir(MCP_NOTEBOOKS_ROOT)
  return MCP_NOTEBOOKS_ROOT
}

export function getMcpNotebookPath(notebookId: string): string {
  return path.join(getMcpNotebooksRoot(), `${notebookId}.inkbook`)
}

export function getInboxNotebookPath(notebookId: string): string {
  return path.join(getInboxRoot(), `${notebookId}.inkbook`)
}

export function getInboxRequestPath(filename: string): string {
  return path.join(getInboxRoot(), filename)
}

/**
 * Returns a non-colliding path inside Inbox for a new notebook keyed by title.
 * If `<title>.inkbook` exists, appends `(2)`, `(3)`, … until unique.
 * Used by create_notebook so a different-id notebook never overwrites an existing file.
 */
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
