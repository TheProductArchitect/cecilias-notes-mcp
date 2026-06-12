import { ToolDefinition } from './index'
import { validate, listNotebooksSchema, toolInputSchema } from '../lib/validate'
import { listAllNotebooks } from '../lib/inkbook'

export const listNotebooks: ToolDefinition = {
  schema: {
    name: 'list_notebooks',
    description: [
      'List notebooks in Cecilia\'s Notes.',
      'Reads the MCP mirror at MCP/notebooks/ and merges any notebooks still',
      'queued in Inbox (marked pending_sync: true) so freshly-created notebooks',
      'are visible before the iPad has had a chance to mirror them back.',
      'Returns id, title, subject, created_at, updated_at, page_count, page_size,',
      'page_template, agent, pending_sync — but not page content. Use read_notebook for content.',
      'Results are sorted by most recently updated.'
    ].join('\n'),
    inputSchema: toolInputSchema(listNotebooksSchema)
  },

  handler: async (args: unknown) => {
    const validation = validate(listNotebooksSchema, args)
    if (!validation.success) {
      return { content: [{ type: 'text' as const, text: validation.error }], isError: true }
    }
    const input = validation.data

    try {
      let notebooks = listAllNotebooks()

      if (input.subject) {
        const subj = input.subject.toLowerCase()
        notebooks = notebooks.filter(n => n.subject.toLowerCase() === subj)
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: notebooks.length,
            notebooks: notebooks.map(({ path: _, ...n }) => n)
          }, null, 2)
        }]
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text' as const, text: `Error listing notebooks: ${message}` }],
        isError: true
      }
    }
  }
}
