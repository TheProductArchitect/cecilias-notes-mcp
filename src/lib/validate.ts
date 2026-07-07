import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

// ── Block schemas (shared between create_notebook and append_to_notebook) ───

const headingBlock = z.object({
  type: z.literal('heading'),
  content: z.string().min(1).max(50000).describe('Heading text.'),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)])
    .describe('Heading level, 1–3.')
})

const paragraphBlock = z.object({
  type: z.literal('paragraph'),
  content: z.string().min(1).max(50000).describe('Paragraph text.')
})

const listBlock = z.object({
  type: z.literal('list'),
  style: z.enum(['bullet', 'numbered']).describe('Bullet or numbered list.'),
  items: z.array(z.string().max(5000)).min(1).max(200)
    .describe('List items, one string per line.')
})

const codeBlock = z.object({
  type: z.literal('code'),
  content: z.string().min(1).max(50000).describe('Code body.'),
  language: z.string().optional().describe('Optional language for syntax hinting (e.g. "swift").')
})

const dividerBlock = z.object({
  type: z.literal('divider')
})

const quoteBlock = z.object({
  type: z.literal('quote'),
  content: z.string().min(1).max(50000).describe('Quote body.'),
  attribution: z.string().max(200).optional().describe('Optional attribution.')
})

const calloutBlock = z.object({
  type: z.literal('callout'),
  content: z.string().min(1).max(50000).describe('Callout body.'),
  kind: z.enum(['note', 'warning', 'tip']).describe('Callout severity.')
})

const blockSchema = z.discriminatedUnion('type', [
  headingBlock, paragraphBlock, listBlock, codeBlock,
  dividerBlock, quoteBlock, calloutBlock
]).describe('A content block. One of: heading, paragraph, list, code, divider, quote, callout.')

const pageSchema = z.array(blockSchema).min(1).max(200)
  .describe('A single page — an array of one or more blocks.')

const pagesSchema = z.array(pageSchema).min(1).max(500)
  .describe('Pages to include. Each page is an array of blocks.')

// ── Tool input schemas ──────────────────────────────────────────────────────

export const createNotebookSchema = z.object({
  title: z.string().min(1).max(200)
    .describe('Notebook title. Shown on the cover card; under 40 characters renders best.'),
  subject: z.string().min(1).max(100).optional()
    .describe('Subject (folder) the notebook lives under. STRONGLY PREFER reusing an existing subject returned by list_subjects over inventing a new one — the iPad app creates a new subject the moment it sees a new name, which clutters the sidebar. Defaults to "inbox" if omitted; the user can re-file later.'),
  pages: pagesSchema,
  cover_tone: z.enum([
    'parchment', 'studio-white', 'ash', 'coal',
    'midnight', 'moss', 'dusk', 'ink-black'
  ]).optional().describe('Cover colour. Omit to let the app assign automatically.'),
  page_template: z.enum([
    'blank', 'lined', 'grid', 'dot-grid', 'cornell', 'music'
  ]).optional().describe('Page template preference. Note: agent-authored notebooks always RENDER on blank white pages (typed text never aligns with rule spacing); the value is stored and round-tripped but does not change rendering.'),
  page_size: z.enum(['a4', 'letter', 'ipad-canvas']).optional()
    .describe('Page size. Default: a4.'),
  model: z.string().optional()
    .describe('The model identifier writing this notebook. Stored alongside agent attribution.'),
  agent_name: z.string().max(80).optional()
    .describe('Display name for the writing agent (e.g. "Claude", "Cursor"). Defaults to "AI agent".')
}).describe('Inputs for create_notebook.')

const uuidSchema = z.string().uuid('must be a valid UUID')
  .describe('UUID of the target notebook.')

export const appendToNotebookSchema = z.object({
  notebook_id: uuidSchema,
  pages: pagesSchema
}).describe('Inputs for append_to_notebook.')

export const listNotebooksSchema = z.object({
  subject: z.string().optional()
    .describe('Filter to a single subject (case-insensitive).')
}).describe('Inputs for list_notebooks.')

export const readNotebookSchema = z.object({
  notebook_id: uuidSchema
}).describe('Inputs for read_notebook.')

export const searchNotesSchema = z.object({
  query: z.string().min(1).max(500)
    .describe('Case-insensitive substring to search for.'),
  subject: z.string().optional()
    .describe('Optional subject filter (case-insensitive).')
}).describe('Inputs for search_notes.')

export const deleteNotebookSchema = z.object({
  notebook_id: uuidSchema
}).describe('Inputs for delete_notebook.')

export const listSubjectsSchema = z.object({}).describe('No input.')

// ── Bridge to MCP tool inputSchema ──────────────────────────────────────────

/**
 * Convert a zod schema into the JSON Schema shape MCP expects for `tool.inputSchema`.
 * Strips wrapper metadata zod-to-json-schema adds ($schema, $ref into definitions).
 */
export function toolInputSchema(schema: z.ZodTypeAny): Tool['inputSchema'] {
  // Cast to any to keep zod-to-json-schema's generics from blowing up on the
  // discriminated-union (TS2589) — runtime behaviour is unaffected.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = zodToJsonSchema(schema as any, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<string, unknown>
  delete json.$schema
  delete json.default
  // MCP expects type === 'object' at the top level.
  if (json.type !== 'object') {
    throw new Error('toolInputSchema: top-level zod schema must be a z.object()')
  }
  return json as Tool['inputSchema']
}

export function validate<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown
): { success: true; data: z.infer<S> } | { success: false; error: string } {
  // Cast to a non-generic ZodTypeAny so TS doesn't try to reconstruct the
  // discriminated-union output type here (which trips TS2589).
  const result = (schema as z.ZodTypeAny).safeParse(input)
  if (result.success) {
    return { success: true, data: result.data as z.infer<S> }
  }
  const messages = result.error.errors
    .map((e: z.ZodIssue) => `  • ${e.path.join('.')}: ${e.message}`)
    .join('\n')
  return {
    success: false,
    error: `Invalid input:\n${messages}`
  }
}
