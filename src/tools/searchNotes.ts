import { ToolDefinition } from './index'
import { validate, searchNotesSchema } from '../lib/validate'
import { searchNotebooks } from '../lib/inkbook'

export const searchNotes: ToolDefinition = {
  schema: {
    name: 'search_notes',
    description: [
      'Search across all notebooks for a case-insensitive substring.',
      'Searches both titles and the plain-text content of every block on every page.',
      'Returns matching notebooks with the page indices where the query was found.',
      'Optionally restrict the search to a single subject.'
    ].join('\n'),
    inputSchema: {
      type: 'object' as const,
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'The text to search for.' },
        subject: {
          type: 'string',
          description: 'Optional subject filter (case-insensitive).'
        }
      }
    }
  },

  handler: async (args: unknown) => {
    const validation = validate(searchNotesSchema, args)
    if (!validation.success) {
      return { content: [{ type: 'text' as const, text: validation.error }], isError: true }
    }
    const input = validation.data

    try {
      const results = searchNotebooks(input.query, input.subject)

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            query: input.query,
            subject: input.subject ?? null,
            count: results.length,
            results: results.slice(0, 20)
          }, null, 2)
        }]
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text' as const, text: `Error searching notes: ${message}` }],
        isError: true
      }
    }
  }
}
