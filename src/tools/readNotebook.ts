import { ToolDefinition } from './index'
import { validate, readNotebookSchema, toolInputSchema } from '../lib/validate'
import { readNotebookById } from '../lib/inkbook'

export const readNotebook: ToolDefinition = {
  schema: {
    name: 'read_notebook',
    description: [
      'Read the full content of a notebook by its UUID.',
      'Falls back to Inbox if the MCP mirror does not yet have the notebook.',
      'Returns the complete .inkbook JSON including all pages and blocks.'
    ].join('\n'),
    inputSchema: toolInputSchema(readNotebookSchema)
  },

  handler: async (args: unknown) => {
    const validation = validate(readNotebookSchema, args)
    if (!validation.success) {
      return { content: [{ type: 'text' as const, text: validation.error }], isError: true }
    }
    const input = validation.data

    try {
      const notebook = readNotebookById(input.notebook_id)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(notebook, null, 2)
        }]
      }
    } catch {
      return {
        content: [{
          type: 'text' as const,
          text: `Notebook ${input.notebook_id} not found. Use list_notebooks to see available notebooks.`
        }],
        isError: true
      }
    }
  }
}
