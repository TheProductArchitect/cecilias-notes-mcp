import { ToolDefinition } from './index'
import { validate, createNotebookSchema } from '../lib/validate'
import {
  buildNotebook,
  buildPage,
  writeNewNotebookToInbox
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
    inputSchema: {
      type: 'object' as const,
      required: ['title', 'subject', 'pages'],
      properties: {
        title: {
          type: 'string',
          description: 'Notebook title. Shown on the cover card. Under 40 characters renders best.'
        },
        subject: {
          type: 'string',
          description: 'Subject. Examples: "Research", "Work", "Personal", "Ideas". Empty string for uncategorised.'
        },
        pages: {
          type: 'array',
          description: 'Array of pages. Each page is an array of blocks.',
          items: {
            type: 'array',
            description: 'One page — array of content blocks.',
            items: {
              type: 'object',
              description: 'A content block. See block types: heading, paragraph, list, code, divider, quote, callout.',
              required: ['type'],
              properties: {
                type: { type: 'string', enum: ['heading','paragraph','list','code','divider','quote','callout'] },
                content: { type: 'string', description: 'Text content. Required for all types except list and divider.' },
                level: { type: 'number', enum: [1,2,3], description: 'Required for heading blocks.' },
                style: { type: 'string', enum: ['bullet','numbered'], description: 'Required for list blocks.' },
                items: { type: 'array', items: { type: 'string' }, description: 'Required for list blocks.' },
                language: { type: 'string', description: 'Optional programming language for code blocks.' },
                attribution: { type: 'string', description: 'Optional attribution for quote blocks.' },
                kind: { type: 'string', enum: ['note','warning','tip'], description: 'Required for callout blocks.' }
              }
            }
          }
        },
        cover_tone: {
          type: 'string',
          enum: ['parchment','studio-white','ash','coal','midnight','moss','dusk','ink-black'],
          description: 'Cover colour. Omit to let the app assign automatically.'
        },
        page_template: {
          type: 'string',
          enum: ['blank','lined','grid','dot-grid','cornell','music'],
          description: 'Page template. Default: lined.'
        },
        page_size: {
          type: 'string',
          enum: ['a4','letter','ipad-canvas'],
          description: 'Page size. Default: a4.'
        },
        model: {
          type: 'string',
          description: 'The model identifier writing this notebook. Used for agent attribution in the app.'
        }
      }
    }
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
          written_by: 'Claude',
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
