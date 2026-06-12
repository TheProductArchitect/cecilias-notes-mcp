import { ToolDefinition } from './index'
import { validate, createNotebookSchema, toolInputSchema } from '../lib/validate'
import {
  buildNotebook,
  buildPage,
  writeNewNotebookToInbox,
  resolveAgentName
} from '../lib/inkbook'
import { TOOL_NAME, Block } from '../types'

const TOOL_VERSION: string = require('../../package.json').version

export const createNotebook: ToolDefinition = {
  schema: {
    name: 'create_notebook',
    description: [
      'Create a new notebook in Cecilia\'s Notes.',
      'The notebook will appear on the user\'s iPad via iCloud sync within seconds.',
      '',
      'Provide structured content as pages (arrays of blocks).',
      'Choose cover_tone to match the mood: midnight or coal for serious notes,',
      'parchment for research, moss for nature or health topics.',
      'If unsure, omit cover_tone — the app assigns one automatically.',
      '',
      'Returns the notebook id — save it to append more pages, read, or delete later.'
    ].join('\n'),
    inputSchema: toolInputSchema(createNotebookSchema)
  },

  handler: async (args: unknown) => {
    const validation = validate(createNotebookSchema, args)
    if (!validation.success) {
      return { content: [{ type: 'text' as const, text: validation.error }], isError: true }
    }
    const input = validation.data

    try {
      const notebook = buildNotebook({
        title: input.title,
        subject: input.subject,
        cover_tone: input.cover_tone,
        page_template: input.page_template,
        page_size: input.page_size,
        agent: {
          written_by: resolveAgentName(input.agent_name),
          model: input.model,
          tool: TOOL_NAME,
          tool_version: TOOL_VERSION
        }
      })

      input.pages.forEach((blocks, i) => {
        notebook.pages.push(buildPage(blocks as Block[], i))
      })

      const filePath = writeNewNotebookToInbox(notebook)

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            notebook_id: notebook.id,
            title: notebook.title,
            subject: notebook.subject,
            pages: notebook.pages.length,
            file: filePath,
            message: `Notebook "${notebook.title}" written to Inbox. It will appear on the user's iPad shortly via iCloud sync.`
          }, null, 2)
        }]
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text' as const, text: `Error creating notebook: ${message}` }],
        isError: true
      }
    }
  }
}
