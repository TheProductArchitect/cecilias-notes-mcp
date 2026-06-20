import { Tool } from '@modelcontextprotocol/sdk/types.js'
import { createNotebook } from './createNotebook'
import { appendToNotebook } from './appendToNotebook'
import { listNotebooks } from './listNotebooks'
import { listSubjects } from './listSubjects'
import { readNotebook } from './readNotebook'
import { searchNotes } from './searchNotes'
import { deleteNotebook } from './deleteNotebook'
import { pairIpad } from './pairIpad'
import { listPairedIpads } from './listPairedIpads'
import { forgetIpad } from './forgetIpad'

export interface ToolDefinition {
  schema: Tool
  handler: (args: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>
}

export const toolRegistry: Record<string, ToolDefinition> = {
  create_notebook:    createNotebook,
  append_to_notebook: appendToNotebook,
  list_notebooks:     listNotebooks,
  list_subjects:      listSubjects,
  read_notebook:      readNotebook,
  search_notes:       searchNotes,
  delete_notebook:    deleteNotebook,
  pair_ipad:          pairIpad,
  list_paired_ipads:  listPairedIpads,
  forget_ipad:        forgetIpad
}
