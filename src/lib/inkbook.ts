import * as fs from 'fs'
import * as path from 'path'
import { v4 as uuidv4 } from 'uuid'
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
  getUniqueInboxTitlePath
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

export function readNotebookById(notebookId: string): Inkbook {
  return readInkbookFile(getMcpNotebookPath(notebookId))
}

// ── Atomic write ────────────────────────────────────────────────────────────

function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmpPath, filePath)
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
    id: uuidv4(),
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
    id: uuidv4(),
    index,
    created_at: new Date().toISOString(),
    blocks: blocks.map(b => ({ ...b, id: uuidv4() }))
  }
}

/**
 * Writes a brand-new notebook to Inbox under a non-colliding title-based filename.
 * Returns the resolved file path.
 */
export function writeNewNotebookToInbox(notebook: Inkbook): string {
  const filePath = getUniqueInboxTitlePath(notebook.title)
  notebook.updated_at = new Date().toISOString()
  writeJsonAtomic(filePath, notebook)
  return filePath
}

/**
 * Writes an updated notebook back to Inbox keyed by its UUID.
 * Used by append_to_notebook — the app dedupes by id and replaces pages wholesale.
 */
export function writeUpdatedNotebookToInbox(notebook: Inkbook): string {
  const filePath = getInboxNotebookPath(notebook.id)
  notebook.updated_at = new Date().toISOString()
  writeJsonAtomic(filePath, notebook)
  return filePath
}

/**
 * Writes a delete-request JSON file to Inbox.
 * The app watches Inbox/, dispatches by the `delete_notebook_request_` prefix,
 * performs the soft delete, and removes both the mirror and the request file.
 */
export function writeDeleteRequest(notebookId: string): string {
  getInboxRoot() // ensure Inbox exists
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
      // Skip malformed files silently
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
