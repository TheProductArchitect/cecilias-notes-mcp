import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'

/** Match Swift's UUID().uuidString casing so app-written and MCP-written
 *  files use identical filenames on case-sensitive volumes. */
function newId(): string {
  return randomUUID().toUpperCase()
}
import {
  Inkbook, Page, Block, AgentInfo,
  CoverTone, PageTemplate, PageSize,
  INKBOOK_SCHEMA_URL, INKBOOK_SCHEMA_VERSION,
  NotebookSummary, SearchResult
} from '../types'
import {
  getInboxRoot,
  getMcpNotebooksRoot,
  getMcpNotebookPath,
  getInboxNotebookPath,
  getInboxRequestPath,
  getUniqueInboxTitlePath,
  findInboxNotebookById
} from './icloud'

// ── Read ────────────────────────────────────────────────────────────────────

export function readInkbookFile(filePath: string): Inkbook {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }
  const raw = fs.readFileSync(filePath, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Malformed .inkbook file: ${path.basename(filePath)}`)
  }
  const nb = parsed as Inkbook
  if (nb.version !== INKBOOK_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported .inkbook version: ${nb.version}. ` +
      `This tool supports version ${INKBOOK_SCHEMA_VERSION}.`
    )
  }
  return nb
}

/**
 * Resolve a notebook by id, preferring the app-maintained mirror but falling
 * back to the most recent Inbox write so a freshly-created notebook is visible
 * before the iPad has had a chance to mirror it back.
 */
export function readNotebookById(notebookId: string): Inkbook {
  const mirrorPath = getMcpNotebookPath(notebookId)
  if (fs.existsSync(mirrorPath)) return readInkbookFile(mirrorPath)
  const inboxPath = findInboxNotebookById(notebookId)
  if (inboxPath) return readInkbookFile(inboxPath)
  throw new Error(`Notebook ${notebookId} not found`)
}

// ── Atomic write ────────────────────────────────────────────────────────────

function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

// ── Agent attribution ───────────────────────────────────────────────────────

/**
 * Attribution for the `written_by` field. Always uses the caller-supplied
 * agent_name (trimmed) and falls back to a neutral default so the package
 * doesn't claim a specific model/vendor wrote a notebook.
 */
export function resolveAgentName(agentName?: string): string {
  const trimmed = agentName?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : 'AI agent'
}

// ── Create ──────────────────────────────────────────────────────────────────

export function buildNotebook(params: {
  title: string
  subject: string
  cover_tone?: CoverTone
  page_template?: PageTemplate
  page_size?: PageSize
  agent: AgentInfo
}): Inkbook {
  const now = new Date().toISOString()
  return {
    $schema: INKBOOK_SCHEMA_URL,
    version: INKBOOK_SCHEMA_VERSION,
    id: newId(),
    title: params.title,
    subject: params.subject,
    created_at: now,
    updated_at: now,
    cover_tone: params.cover_tone,
    // page_template intentionally left undefined when caller omits it so the
    // iPad app's "blank" default (v1.2 importer) applies. Pass an explicit
    // value when the notebook should be ruled / grid / cornell / music.
    page_template: params.page_template,
    page_size: params.page_size ?? 'a4',
    agent: params.agent,
    pages: []
  }
}

export function buildPage(blocks: Block[], index: number): Page {
  return {
    id: newId(),
    index,
    created_at: new Date().toISOString(),
    blocks: blocks.map(b => ({ ...b, id: newId() }))
  }
}

/**
 * Brand-new notebook → Inbox under a non-colliding title-based filename.
 */
export function writeNewNotebookToInbox(notebook: Inkbook): string {
  const filePath = getUniqueInboxTitlePath(notebook.title)
  notebook.updated_at = new Date().toISOString()
  notebook.mcp_action = 'create'
  writeJsonAtomic(filePath, notebook)
  return filePath
}

/**
 * Updated notebook (append) → Inbox keyed by UUID.
 * Records the base updated_at so the app can detect divergence
 * with iPad-side edits and avoid clobbering them.
 */
export function writeUpdatedNotebookToInbox(
  notebook: Inkbook,
  baseUpdatedAt: string
): string {
  const filePath = getInboxNotebookPath(notebook.id)
  notebook.updated_at = new Date().toISOString()
  notebook.base_updated_at = baseUpdatedAt
  notebook.mcp_action = 'append'
  writeJsonAtomic(filePath, notebook)
  return filePath
}

export function writeDeleteRequest(notebookId: string): string {
  getInboxRoot()
  const filePath = getInboxRequestPath(`delete_notebook_request_${notebookId}.json`)
  const payload = { action: 'delete_notebook', notebook_id: notebookId }
  writeJsonAtomic(filePath, payload)
  return filePath
}

// ── List ────────────────────────────────────────────────────────────────────

function summaryFromNotebook(
  nb: Inkbook,
  filePath: string,
  pendingSync: boolean
): NotebookSummary & { path: string } {
  return {
    path: filePath,
    id: nb.id,
    title: nb.title,
    subject: nb.subject,
    created_at: nb.created_at,
    updated_at: nb.updated_at,
    page_count: nb.pages.length,
    page_size: nb.page_size,
    page_template: nb.page_template,
    agent: nb.agent
      ? { written_by: nb.agent.written_by, model: nb.agent.model }
      : null,
    pending_sync: pendingSync
  }
}

function readDirSafe(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith('.inkbook'))
  } catch {
    return []
  }
}

export function listAllNotebooks(): Array<NotebookSummary & { path: string }> {
  // Prefer the app-maintained mirror; fall back to Inbox-only entries so
  // freshly-created notebooks show up before the iPad has mirrored them back.
  const byId = new Map<string, NotebookSummary & { path: string }>()

  let mirrorRoot: string | null = null
  try { mirrorRoot = getMcpNotebooksRoot() } catch {}

  if (mirrorRoot) {
    for (const file of readDirSafe(mirrorRoot)) {
      const filePath = path.join(mirrorRoot, file)
      try {
        const nb = readInkbookFile(filePath)
        byId.set(nb.id.toLowerCase(), summaryFromNotebook(nb, filePath, false))
      } catch {}
    }
  }

  let inboxRoot: string | null = null
  try { inboxRoot = getInboxRoot() } catch {}

  if (inboxRoot) {
    for (const file of readDirSafe(inboxRoot)) {
      const filePath = path.join(inboxRoot, file)
      try {
        const nb = readInkbookFile(filePath)
        const key = nb.id.toLowerCase()
        if (!byId.has(key)) {
          byId.set(key, summaryFromNotebook(nb, filePath, true))
        }
      } catch {}
    }
  }

  return [...byId.values()].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  )
}

// ── Search ──────────────────────────────────────────────────────────────────

export function searchNotebooks(query: string, subjectFilter?: string): SearchResult[] {
  const q = query.toLowerCase()
  const subj = subjectFilter?.toLowerCase()
  const results: SearchResult[] = []

  const summaries = listAllNotebooks().filter(
    s => !subj || s.subject.toLowerCase() === subj
  )

  for (const summary of summaries) {
    let nb: Inkbook
    try {
      nb = readInkbookFile(summary.path)
    } catch {
      continue
    }

    const titleMatch = nb.title.toLowerCase().includes(q)
    const matchingPages: Array<{ index: number; preview: string }> = []

    for (const page of nb.pages) {
      for (const block of page.blocks) {
        const text = blockToPlainText(block)
        if (text.toLowerCase().includes(q)) {
          matchingPages.push({
            index: page.index,
            preview: text.substring(0, 160)
          })
          break
        }
      }
    }

    if (titleMatch || matchingPages.length > 0) {
      results.push({
        notebook_id: nb.id,
        title: nb.title,
        subject: nb.subject,
        title_match: titleMatch,
        matching_pages: matchingPages
      })
    }
  }

  return results
}

// ── Subjects ────────────────────────────────────────────────────────────────

export interface SubjectSummary {
  subject: string
  count: number
}

/**
 * Returns the unique set of subjects currently in use across every notebook
 * the MCP can see (mirror + Inbox, deduped by notebook id), sorted by count
 * descending then alphabetically. The empty-string subject is filtered out —
 * v1.2 of the app treats it as "uncategorised" and shouldn't be steered to.
 */
export function listAllSubjects(): SubjectSummary[] {
  const counts = new Map<string, number>()
  for (const nb of listAllNotebooks()) {
    const s = nb.subject?.trim()
    if (!s) continue
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([subject, count]) => ({ subject, count }))
    .sort((a, b) => b.count - a.count || a.subject.localeCompare(b.subject))
}

/** Case-insensitive membership check used to decide whether to warn on stderr. */
export function isNewSubject(subject: string): boolean {
  const wanted = subject.trim().toLowerCase()
  if (!wanted) return false
  return !listAllSubjects().some(s => s.subject.toLowerCase() === wanted)
}

function blockToPlainText(block: Block): string {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
    case 'code':
    case 'quote':
    case 'callout':
      return block.content
    case 'list':
      return block.items.join('\n')
    case 'divider':
      return ''
  }
}
