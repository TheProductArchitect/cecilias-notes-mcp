import { z } from 'zod'

const blockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    content: z.string().min(1).max(50000),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)])
  }),
  z.object({
    type: z.literal('paragraph'),
    content: z.string().min(1).max(50000)
  }),
  z.object({
    type: z.literal('list'),
    style: z.enum(['bullet', 'numbered']),
    items: z.array(z.string().max(5000)).min(1).max(200)
  }),
  z.object({
    type: z.literal('code'),
    content: z.string().min(1).max(50000),
    language: z.string().optional()
  }),
  z.object({
    type: z.literal('divider')
  }),
  z.object({
    type: z.literal('quote'),
    content: z.string().min(1).max(50000),
    attribution: z.string().max(200).optional()
  }),
  z.object({
    type: z.literal('callout'),
    content: z.string().min(1).max(50000),
    kind: z.enum(['note', 'warning', 'tip'])
  })
])

const pagesSchema = z
  .array(z.array(blockSchema).min(1).max(200))
  .min(1)
  .max(500)

export const createNotebookSchema = z.object({
  title: z.string()
    .min(1, 'title is required')
    .max(200, 'title must be under 200 characters'),
  subject: z.string()
    .min(1, 'subject is required')
    .max(100, 'subject must be under 100 characters'),
  pages: pagesSchema,
  cover_tone: z.enum([
    'parchment', 'studio-white', 'ash', 'coal',
    'midnight', 'moss', 'dusk', 'ink-black'
  ]).optional(),
  page_template: z.enum([
    'blank', 'lined', 'grid', 'dot-grid', 'cornell', 'music'
  ]).optional(),
  page_size: z.enum(['a4', 'letter', 'ipad-canvas']).optional(),
  model: z.string().optional()
})

const uuidSchema = z.string().uuid('must be a valid UUID')

export const appendToNotebookSchema = z.object({
  notebook_id: uuidSchema,
  pages: pagesSchema
})

export const listNotebooksSchema = z.object({
  subject: z.string().optional()
})

export const readNotebookSchema = z.object({
  notebook_id: uuidSchema
})

export const searchNotesSchema = z.object({
  query: z.string()
    .min(1, 'query is required')
    .max(500, 'query must be under 500 characters'),
  subject: z.string().optional()
})

export const deleteNotebookSchema = z.object({
  notebook_id: uuidSchema
})

export function validate<T>(
  schema: z.ZodSchema<T>,
  input: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(input)
  if (result.success) {
    return { success: true, data: result.data }
  }
  const messages = result.error.errors
    .map(e => `  • ${e.path.join('.')}: ${e.message}`)
    .join('\n')
  return {
    success: false,
    error: `Invalid input:\n${messages}`
  }
}
