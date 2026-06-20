import { ToolDefinition } from './index'
import { validate, listSubjectsSchema, toolInputSchema } from '../lib/validate'
import { listAllSubjects } from '../lib/inkbook'

export const listSubjects: ToolDefinition = {
  schema: {
    name: 'list_subjects',
    description: [
      'Return the unique set of subjects currently in use across the user\'s notebooks,',
      'sorted by count descending.',
      '',
      '## Call this BEFORE create_notebook',
      'The iPad app creates a new subject the moment it sees a new name in an',
      'imported .inkbook — every "imagined" subject balloons the user\'s sidebar.',
      'Calling list_subjects first lets you reuse an existing subject that fits',
      'semantically (e.g. a notebook on Lagrangian mechanics should route to an',
      'existing "physics" subject rather than a new "classical-mechanics" one).',
      '',
      'Rules of thumb:',
      '- A new notebook ALMOST ALWAYS belongs in an existing subject. Reuse aggressively.',
      '- Match semantically, not literally — "physics" covers Lagrangian mechanics,',
      '  thermodynamics, quantum, etc.',
      '- Only invent a new subject when nothing existing is a reasonable fit.',
      '- When in doubt, use "inbox" — the user can re-file later.',
      '',
      'Returns: { count, subjects: [ { subject, count } ] }'
    ].join('\n'),
    inputSchema: toolInputSchema(listSubjectsSchema)
  },

  handler: async (args: unknown) => {
    const validation = validate(listSubjectsSchema, args)
    if (!validation.success) {
      return { content: [{ type: 'text' as const, text: validation.error }], isError: true }
    }

    try {
      const subjects = listAllSubjects()
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: subjects.length,
            subjects
          }, null, 2)
        }]
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text' as const, text: `Error listing subjects: ${message}` }],
        isError: true
      }
    }
  }
}
