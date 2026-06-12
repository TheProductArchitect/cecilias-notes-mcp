export const INKBOOK_SCHEMA_VERSION = '1' as const
export const INKBOOK_SCHEMA_URL = 'https://venugopinath.me/cecilias-notes/schemas/inkbook/v1.json' as const
export const TOOL_NAME = 'cecilias-notes-mcp' as const

export type CoverTone =
  | 'parchment'
  | 'studio-white'
  | 'ash'
  | 'coal'
  | 'midnight'
  | 'moss'
  | 'dusk'
  | 'ink-black'

export type PageTemplate =
  | 'blank'
  | 'lined'
  | 'grid'
  | 'dot-grid'
  | 'cornell'
  | 'music'

export type PageSize = 'a4' | 'letter' | 'ipad-canvas'

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'code'
  | 'divider'
  | 'quote'
  | 'callout'

export type ListStyle = 'bullet' | 'numbered'
export type HeadingLevel = 1 | 2 | 3
export type CalloutKind = 'note' | 'warning' | 'tip'

export type Block =
  | { type: 'heading';   id: string; content: string; level: HeadingLevel }
  | { type: 'paragraph'; id: string; content: string }
  | { type: 'list';      id: string; style: ListStyle; items: string[] }
  | { type: 'code';      id: string; content: string; language?: string }
  | { type: 'divider';   id: string }
  | { type: 'quote';     id: string; content: string; attribution?: string }
  | { type: 'callout';   id: string; content: string; kind: CalloutKind }

export interface Page {
  id: string
  index: number
  created_at: string
  blocks: Block[]
}

export interface AgentInfo {
  written_by: string
  model?: string
  tool: typeof TOOL_NAME
  tool_version: string
}

export type McpAction = 'create' | 'append' | 'replace'

export interface Inkbook {
  $schema: typeof INKBOOK_SCHEMA_URL
  version: typeof INKBOOK_SCHEMA_VERSION
  id: string
  title: string
  subject: string
  created_at: string
  updated_at: string
  cover_tone?: CoverTone
  page_template?: PageTemplate
  page_size?: PageSize
  agent?: AgentInfo
  /** Optimistic concurrency: the updated_at observed before this write. */
  base_updated_at?: string
  /** Discriminator the app uses to pick create/append/replace import strategy. */
  mcp_action?: McpAction
  pages: Page[]
}

export interface CreateNotebookInput {
  title: string
  subject: string
  pages: Block[][]
  cover_tone?: CoverTone
  page_template?: PageTemplate
  page_size?: PageSize
  model?: string
  agent_name?: string
}

export interface AppendToNotebookInput {
  notebook_id: string
  pages: Block[][]
}

export interface ListNotebooksInput {
  subject?: string
}

export interface ReadNotebookInput {
  notebook_id: string
}

export interface SearchNotesInput {
  query: string
  subject?: string
}

export interface DeleteNotebookInput {
  notebook_id: string
}

export interface NotebookSummary {
  id: string
  title: string
  subject: string
  created_at: string
  updated_at: string
  page_count: number
  page_size?: PageSize
  page_template?: PageTemplate
  agent?: {
    written_by: string
    model?: string
  } | null
  /** True when the notebook only exists in Inbox (not yet mirrored back by the iPad). */
  pending_sync: boolean
}

export interface SearchResult {
  notebook_id: string
  title: string
  subject: string
  title_match: boolean
  matching_pages: Array<{ index: number; preview: string }>
}
