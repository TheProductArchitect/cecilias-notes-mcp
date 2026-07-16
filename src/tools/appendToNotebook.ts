import { ToolDefinition } from './index'
import { validate, appendToNotebookSchema, toolInputSchema } from '../lib/validate'
import {
  readNotebookById,
  buildPage,
  writeUpdatedNotebookToInbox
} from '../lib/inkbook'
import { Block } from '../types'

export const appendToNotebook: ToolDefinition = {
  schema: {
    name: 'append_to_notebook',
    description: [
      'Append one or more pages to an existing notebook.',
      'Identify the notebook by its UUID (from create_notebook or list_notebooks).',
      '',
      'The full notebook is read from the MCP mirror, the new pages are',
      'appended, every page index is re-numbered from 0, and the updated',
      'notebook is written back to Inbox. The iPad app\'s v1.2 importer merges',
      'pages BY PAGE ID — existing pages keep their original blocks, only the',
      'new pages this call adds are inserted.',
      '',
      '## Write STRUCTURED content for the new pages',
      'New pages should use the same block vocabulary as create_notebook —',
      'do NOT flatten content into a single paragraph block just because it',
      'is "simpler." The renderer styles each block type natively.',
      '',
      '### Block vocabulary (same as create_notebook)',
      '- `{ "type": "heading",   "content": "…", "level": 1|2|3 }`',
      '- `{ "type": "paragraph", "content": "…" }`',
      '- `{ "type": "list",      "style": "bullet"|"numbered", "items": ["…", …] }`',
      '- `{ "type": "code",      "content": "…", "language": "swift" }` (language optional)',
      '- `{ "type": "quote",     "content": "…", "attribution": "…" }` (attribution optional)',
      '- `{ "type": "callout",   "content": "…", "kind": "note"|"warning"|"tip" }`',
      '- `{ "type": "divider" }`',
      '',
      '### Inline styling (inside any content string)',
      'Content strings support inline markdown: `**bold**`, `*italic*` or',
      '`_italic_`, and backtick `code` spans render natively on the page',
      '(app build 2026-07-16+; older builds show the markers literally).',
      'Unbalanced markers stay literal. Code BLOCKS are always verbatim.',
      '',
      'Rules of thumb:',
      '- Use `heading` for every section title you write.',
      '- Use `list` for three or more parallel items.',
      '- Use `callout` (kind `tip`) for "remember this" asides.',
      '- Use `quote` whenever citing a person or source.',
      '- Use `divider` between major sections.',
      '',
      '### Example payload',
      '',
      '```json',
      '{',
      '  "notebook_id": "1A2B3C4D-...-UPPERCASE",',
      '  "pages": [[',
      '    { "type": "heading", "content": "Follow-ups", "level": 2 },',
      '    { "type": "list",    "style": "numbered",',
      '                         "items": ["Send recap to Cecilia", "Open PR for importer", "Schedule device test"] },',
      '    { "type": "callout", "content": "Block calendar for Friday demo.", "kind": "tip" }',
      '  ]]',
      '}',
      '```'
    ].join('\n'),
    inputSchema: toolInputSchema(appendToNotebookSchema)
  },

  handler: async (args: unknown) => {
    const validation = validate(appendToNotebookSchema, args)
    if (!validation.success) {
      return { content: [{ type: 'text' as const, text: validation.error }], isError: true }
    }
    const input = validation.data

    try {
      let notebook
      try {
        notebook = readNotebookById(input.notebook_id)
      } catch (_e) {
        return {
          content: [{
            type: 'text' as const,
            text: `Notebook ${input.notebook_id} not found. Use list_notebooks to see available notebooks.`
          }],
          isError: true
        }
      }

      const baseUpdatedAt = notebook.updated_at
      const addedStart = notebook.pages.length
      input.pages.forEach((blocks) => {
        notebook.pages.push(buildPage(blocks as Block[], notebook.pages.length))
      })

      // Re-index every page sequentially from 0 so the app's sort order is correct.
      notebook.pages.forEach((page, i) => {
        page.index = i
      })

      const filePath = writeUpdatedNotebookToInbox(notebook, baseUpdatedAt)

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            notebook_id: notebook.id,
            pages_added: input.pages.length,
            total_pages: notebook.pages.length,
            appended_page_indices: notebook.pages.slice(addedStart).map(p => p.index),
            file: filePath,
            message: `Added ${input.pages.length} page(s) to "${notebook.title}".`
          }, null, 2)
        }]
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text' as const, text: `Error appending to notebook: ${message}` }],
        isError: true
      }
    }
  }
}
