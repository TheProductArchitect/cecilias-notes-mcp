import { z } from 'zod'
import { ToolDefinition } from './index'
import { validate, toolInputSchema } from '../lib/validate'
import { listPairedPeers, discoverPeers } from '../lib/multipeer'

const listPairedIpadsSchema = z.object({
  discover_ms: z.number().int().min(0).max(5000).optional()
    .describe('Discovery window for nearby (unpaired) iPads. Default 1500ms. Set 0 to skip.')
}).describe('Inputs for list_paired_ipads.')

export const listPairedIpads: ToolDefinition = {
  schema: {
    name: 'list_paired_ipads',
    description: [
      'Return the iPads currently paired with this Mac (stored in macOS Keychain)',
      'and any nearby unpaired iPads discovered over multipeer in a short window.',
      '',
      'Use this to:',
      '- Verify the user\'s iPad is reachable before suggesting multipeer.',
      '- Look up the exact display name to pass to pair_ipad.',
      '',
      'Returns: { paired: [...names], nearby: [{ peer, paired }], reachable: bool, fallback_reason? }'
    ].join('\n'),
    inputSchema: toolInputSchema(listPairedIpadsSchema)
  },

  handler: async (args: unknown) => {
    const validation = validate(listPairedIpadsSchema, args)
    if (!validation.success) {
      return { content: [{ type: 'text' as const, text: validation.error }], isError: true }
    }
    const { discover_ms } = validation.data

    const paired = await listPairedPeers()

    let nearby: Array<{ peer: string; paired: boolean }> = []
    let fallbackReason: string | undefined
    let detail: string | undefined

    if ((discover_ms ?? 1500) > 0) {
      const discovery = await discoverPeers(discover_ms ?? 1500)
      if (discovery.fallback) {
        fallbackReason = discovery.fallback
        detail = discovery.detail
      } else {
        nearby = discovery.peers
      }
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          paired,
          nearby,
          reachable: nearby.some(p => p.paired),
          fallback_reason: fallbackReason,
          detail
        }, null, 2)
      }]
    }
  }
}
