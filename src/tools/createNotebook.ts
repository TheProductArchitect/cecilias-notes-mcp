import { ToolDefinition } from './index'
import { validate, createNotebookSchema, toolInputSchema } from '../lib/validate'
import * as fs from 'fs'
import * as path from 'path'
import {
  buildNotebook,
  buildPage,
  writeNewNotebookToInbox,
  resolveAgentName,
  isNewSubject,
  listAllSubjects
} from '../lib/inkbook'
import { tryDeliverViaMultipeer } from '../lib/multipeer'
import { TOOL_NAME, Block } from '../types'

const TOOL_VERSION: string = require('../../package.json').version

export const createNotebook: ToolDefinition = {
  schema: {
    name: 'create_notebook',
    description: [
      'Create a new notebook in Cecilia\'s Notes. Appears on the user\'s iPad',
      'via iCloud sync within seconds.',
      '',
      '## ⚠️ Pick a subject deliberately',
      'Subject is the folder the notebook lives under on the iPad. The app',
      'CREATES a new subject the moment it sees a new name, so every imagined',
      'subject permanently clutters the user\'s sidebar.',
      '',
      'Before calling this tool you SHOULD:',
      '1. Call `list_subjects` to see what subjects already exist.',
      '2. Pick the existing subject that best matches the notebook\'s topic',
      '   semantically — e.g. a notebook on Lagrangian mechanics belongs in',
      '   an existing "physics", not a new "classical-mechanics".',
      '3. Only invent a new subject when NONE of the existing ones fit.',
      '4. When in doubt, omit the `subject` field — it defaults to "inbox",',
      '   the well-known unsorted bucket. The user can re-file later.',
      '',
      'If the user names a subject in their prompt ("save to my philosophy notes"),',
      'use that subject verbatim — do not second-guess.',
      '',
      '## Write STRUCTURED content, not flat prose',
      'Pages are arrays of typed blocks. The iPad renderer styles each type',
      'natively (H1 larger than H2, callouts have a coloured background, code',
      'is monospaced, lists indent, quotes are italicised). Use the structure',
      '— do not collapse everything into one long paragraph.',
      '',
      '### Block vocabulary',
      '- `{ "type": "heading", "content": "…", "level": 1|2|3 }`',
      '    use whenever you are writing a section title (H1 for the page,',
      '    H2/H3 for subsections).',
      '- `{ "type": "paragraph", "content": "…" }`',
      '    body prose. Break into multiple paragraphs at logical breaks; do',
      '    NOT pack an entire page into one paragraph block.',
      '- `{ "type": "list", "style": "bullet"|"numbered", "items": ["…", …] }`',
      '    use for any series of three or more parallel items.',
      '- `{ "type": "code", "content": "…", "language": "swift" }` (language optional)',
      '    monospaced, preserves whitespace.',
      '- `{ "type": "quote", "content": "…", "attribution": "…" }` (attribution optional)',
      '    use whenever citing a person or source.',
      '- `{ "type": "callout", "content": "…", "kind": "note"|"warning"|"tip" }`',
      '    short emphasised box. Use `tip` for "remember this" / "pro tip"',
      '    asides, `warning` for caveats, `note` for incidental context.',
      '- `{ "type": "divider" }`',
      '    horizontal rule. Use between major sections.',
      '',
      '### Inline styling (inside any content string)',
      'Content strings support inline markdown: `**bold**`, `*italic*` or',
      '`_italic_`, and backtick `code` spans render natively on the page',
      '(app build 2026-07-16+; older builds show the markers literally).',
      'Unbalanced markers stay literal. Code BLOCKS are always verbatim.',
      '',
      '### page_template',
      'Optional top-level field. Defaults to "blank" on device when omitted —',
      'best for free-form AI prose. Pass a value when the notebook should',
      'show a specific background:',
      '  "blank" | "lined" | "grid" | "dot-grid" | "cornell" | "music"',
      '',
      '### Worked example',
      'A request like "make me a kickoff page" should produce something like:',
      '',
      '```json',
      '{',
      '  "title": "Project Kickoff",',
      '  "subject": "Work",',
      '  "page_template": "blank",',
      '  "pages": [[',
      '    { "type": "heading",   "content": "Goals", "level": 1 },',
      '    { "type": "paragraph", "content": "Two-sentence framing of what we\'re trying to do." },',
      '    { "type": "list",      "style": "bullet",',
      '                           "items": ["Ship the v1 importer", "Verify on device", "Demo to Cecilia"] },',
      '    { "type": "callout",   "content": "Demo is Friday afternoon.", "kind": "tip" },',
      '    { "type": "divider" },',
      '    { "type": "heading",   "content": "Open questions", "level": 2 },',
      '    { "type": "paragraph", "content": "What does success look like?" }',
      '  ]]',
      '}',
      '```',
      '',
      'Note: heading + paragraph + list + callout + divider in a single page',
      '— that is the structural target, not a single 800-word paragraph.',
      '',
      'Choose cover_tone to match the mood: midnight or coal for serious notes,',
      'parchment for research, moss for nature or health topics. Omit to let',
      'the app pick.',
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
      const explicitSubject = input.subject?.trim()
      const resolvedSubject = explicitSubject && explicitSubject.length > 0
        ? explicitSubject
        : 'inbox'

      const existingSubjects = listAllSubjects()
      const subjectIsNew = isNewSubject(resolvedSubject)
      if (subjectIsNew && resolvedSubject.toLowerCase() !== 'inbox') {
        // Audit signal: surfaces in the MCP client's stderr so the user
        // can see when an agent invented a new subject.
        const reason = explicitSubject
          ? 'explicitly requested'
          : existingSubjects.length === 0
            ? 'no existing subjects on disk'
            : 'agent did not match any existing subject'
        process.stderr.write(
          `cecilias-notes-mcp: created notebook with NEW subject "${resolvedSubject}" (${reason}). ` +
          `Existing subjects: ${existingSubjects.map(s => s.subject).join(', ') || '(none)'}\n`
        )
      }

      const notebook = buildNotebook({
        title: input.title,
        subject: resolvedSubject,
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

      // iCloud Inbox write is the durable record; it always runs.
      const filePath = writeNewNotebookToInbox(notebook)
      const fileBytes = fs.readFileSync(filePath)

      // Best-effort multipeer accelerator. Falls back silently to iCloud.
      const delivery = await tryDeliverViaMultipeer({
        fileBytes,
        filename: path.basename(filePath),
        budgetMs: 2000
      })

      const baseMessage = subjectIsNew && resolvedSubject !== 'inbox'
        ? `Notebook "${notebook.title}" written to Inbox under NEW subject "${notebook.subject}". The iPad will create this subject on import.`
        : `Notebook "${notebook.title}" written to Inbox under subject "${notebook.subject}".`

      const deliveryMessage = delivery.transport === 'multipeer'
        ? `Sent directly to "${delivery.peer}" in ${delivery.latency_ms}ms via multipeer.`
        : `iCloud sync will deliver it to the iPad in ${delivery.estimated_latency_seconds[0]}–${delivery.estimated_latency_seconds[1]}s.`

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            notebook_id: notebook.id,
            title: notebook.title,
            subject: notebook.subject,
            subject_is_new: subjectIsNew,
            existing_subjects: existingSubjects.map(s => s.subject),
            pages: notebook.pages.length,
            file: filePath,
            delivery,
            message: `${baseMessage} ${deliveryMessage}`
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
