import { z } from 'zod'
import { ToolDefinition } from './index'
import { validate, toolInputSchema } from '../lib/validate'
import { forgetPeer } from '../lib/multipeer'

const forgetIpadSchema = z.object({
  peer: z.string().min(1).max(120)
    .describe('Display name of the iPad to forget. After this, create_notebook will fall back to iCloud delivery until the iPad is re-paired.')
}).describe('Inputs for forget_ipad.')

export const forgetIpad: ToolDefinition = {
  schema: {
    name: 'forget_ipad',
    description: [
      'Remove a paired iPad from the Mac\'s Keychain.',
      'Future create_notebook calls will fall back to iCloud-only delivery for',
      'this iPad until it\'s re-paired. Does not affect the iPad\'s own pairing',
      'list — the user should also tap "forget" on the iPad if they want the',
      'pairing fully revoked.',
      '',
      'Returns: { ok: bool, peer }.'
    ].join('\n'),
    inputSchema: toolInputSchema(forgetIpadSchema)
  },

  handler: async (args: unknown) => {
    const validation = validate(forgetIpadSchema, args)
    if (!validation.success) {
      return { content: [{ type: 'text' as const, text: validation.error }], isError: true }
    }
    const { peer } = validation.data
    const ok = await forgetPeer(peer)
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          ok,
          peer,
          message: ok
            ? `Forgot "${peer}". Re-pair via pair_ipad if needed.`
            : `Failed to forget "${peer}". Sidecar may be unavailable or the peer was not paired.`
        }, null, 2)
      }],
      isError: !ok
    }
  }
}
