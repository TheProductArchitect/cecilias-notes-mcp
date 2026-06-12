import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
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
 * Best-effort attribution for the `written_by` field.
 * Prefers an explicit override, then derives from the model prefix.
 */
export function deriveAgentName(model?: string, override?: string): string {
  if (override && override.trim()) return override.trim()
  if (!model) return 'Agent'
  const m = model.toLowerCase()
  if (m.startsWith('claude')) return 'Claude'
  if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'GPT'
  if (m.startsWith('gemini')) return 'Gemini'
  if (m.startsWith('grok')) return 'Grok'
  if (m.startsWith('llama')) return 'Llama'
  if (m.startsWith('mistral')) return 'Mistral'
  return 'Agent'
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
    id: randomUUID(),
    title: params.title,
    subject: params.subject,
    created_at: now,
    updated_at: now,
    cover_tone: params.cover_tone,
    page_template: params.page_template ?? 'lined',
    page_size: params.page_size ?? 'a4',
    agent: params.agent,
    pages: []
  }
}

export function buildPage(blocks: Block[], index: number): Page {
  return {
    id: randomUUID(),
    index,
    created_at: new Date().toISOString(),
    blocks: blocks.map(b => ({ ...b, id: randomUUID() }))
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

export function listAllNotebooks(): Array<NotebookSummary & { path: string }> {
  let root: string
  try {
    root = getMcpNotebooksRoot()
  } catch {
    return []
  }

  let files: string[]
  try {
    files = fs.readdirSync(root).filter(f => f.endsWith('.inkbook'))
  } catch {
    return []
  }

  const results: Array<NotebookSummary & { path: string }> = []
  for (const file of files) {
    const filePath = path.join(root, file)
    try {
      const nb = readInkbookFile(filePath)
      results.push({
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
          : null
      })
    } catch {
      // skip malformed files
    }
  }

  return results.sort(
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
