import { ToolDefinition } from './index'
import { validate, deleteNotebookSchema, toolInputSchema } from '../lib/validate'
import { writeDeleteRequest } from '../lib/inkbook'

export const deleteNotebook: ToolDefinition = {
  schema: {
    name: 'delete_notebook',
    description: [
      'Soft-delete a notebook by writing a delete-request file to Inbox.',
      'The app processes the request asynchronously, soft-deletes the notebook,',
      'removes the MCP mirror, and deletes the request file from Inbox.',
      'Returns immediately (fire-and-forget). The user can recover the notebook',
      'from the app for 30 days.'
    ].join('\n'),
    inputSchema: toolInputSchema(deleteNotebookSchema)
  },

  handler: async (args: unknown) => {
    const validation = validate(deleteNotebookSchema, args)
    if (!validation.success) {
      return { content: [{ type: 'text' as const, text: validation.error }], isError: true }
    }
    const input = validation.data

    try {
      const requestPath = writeDeleteRequest(input.notebook_id)

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            notebook_id: input.notebook_id,
            request_file: requestPath,
            message: `Delete request submitted for notebook ${input.notebook_id}. ` +
                     `The app will process it on the next iCloud sync. ` +
                     `The user can recover it from the app for 30 days.`
          }, null, 2)
        }]
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text' as const, text: `Error submitting delete request: ${message}` }],
        isError: true
      }
    }
  }
}
