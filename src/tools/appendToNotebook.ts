import { ToolDefinition } from './index'
import { validate, appendToNotebookSchema } from '../lib/validate'
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
      'Identify the notebook by its UUID (returned from create_notebook or list_notebooks).',
      'The full notebook is read from the MCP mirror, the new pages are appended,',
      'every page index is re-numbered from 0, and the updated notebook is written',
      'back to Inbox. The app dedupes by id and replaces pages wholesale.'
    ].join('\n'),
    inputSchema: {
      type: 'object' as const,
      required: ['notebook_id', 'pages'],
      properties: {
        notebook_id: {
          type: 'string',
          description: 'UUID of the existing notebook to append to.'
        },
        pages: {
          type: 'array',
          description: 'Pages to append. Each page is an array of blocks (same shape as create_notebook).',
          items: {
            type: 'array',
            items: {
              type: 'object',
              required: ['type'],
              properties: {
                type: { type: 'string', enum: ['heading','paragraph','list','code','divider','quote','callout'] },
                content: { type: 'string' },
                level: { type: 'number', enum: [1,2,3] },
                style: { type: 'string', enum: ['bullet','numbered'] },
                items: { type: 'array', items: { type: 'string' } },
                language: { type: 'string' },
                attribution: { type: 'string' },
                kind: { type: 'string', enum: ['note','warning','tip'] }
              }
            }
          }
        }
      }
    }
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
      } catch {
        return {
          content: [{
            type: 'text' as const,
            text: `Notebook ${input.notebook_id} not found. Use list_notebooks to see available notebooks.`
          }],
          isError: true
        }
      }

      const addedStart = notebook.pages.length
      input.pages.forEach((blocks) => {
        notebook.pages.push(buildPage(blocks as Block[], notebook.pages.length))
      })

      // Re-index every page sequentially from 0 so the app's sort order is correct.
      notebook.pages.forEach((page, i) => {
        page.index = i
      })

      const filePath = writeUpdatedNotebookToInbox(notebook)

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
