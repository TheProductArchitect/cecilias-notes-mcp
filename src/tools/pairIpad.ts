import { z } from 'zod'
import { ToolDefinition } from './index'
import { validate, toolInputSchema } from '../lib/validate'
import { pairPeer, discoverPeers } from '../lib/multipeer'

const pairIpadSchema = z.object({
  peer: z.string().min(1).max(120)
    .describe('Display name of the iPad as it appears in the discovery list (e.g. "Venu\'s iPad").'),
  code: z.string().regex(/^\d{6}$/, 'pairing code must be exactly 6 digits')
    .describe('The 6-digit code the iPad is currently displaying in Settings → cloud → show pairing code.')
}).describe('Inputs for pair_ipad.')

export const pairIpad: ToolDefinition = {
  schema: {
    name: 'pair_ipad',
    description: [
      'Pair this Mac to a nearby iPad so future create_notebook calls can deliver',
      'directly via multipeer instead of waiting on iCloud sync.',
      '',
      '## UX flow',
      '1. Ask the user to open Cecilia\'s Notes on the iPad, go to Settings → cloud,',
      '   and tap "show pairing code". The iPad will display a 6-digit code and',
      '   enter a 90-second pairing window.',
      '2. Ask the user for that 6-digit code AND the iPad\'s name (you can call',
      '   list_paired_ipads first to see what\'s visible; unpaired peers appear there too).',
      '3. Call this tool with both values.',
      '',
      'On success the shared key is stored in the Mac\'s system Keychain and',
      'subsequent create_notebook calls auto-use multipeer.',
      '',
      'Returns: { ok: true, peer } on success, { ok: false, reason } otherwise.',
      'Reasons: wrong_code, pairing_window_expired, no_peer_visible, sidecar_unavailable,',
      'service_type_invalid (protocol issue — see PR notes).'
    ].join('\n'),
    inputSchema: toolInputSchema(pairIpadSchema)
  },

  handler: async (args: unknown) => {
    const validation = validate(pairIpadSchema, args)
    if (!validation.success) {
      return { content: [{ type: 'text' as const, text: validation.error }], isError: true }
    }
    const { peer, code } = validation.data

    // Pre-check: confirm the peer is visible so we can give a better error.
    const { peers, fallback } = await discoverPeers(1500)
    if (fallback) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ok: false, reason: fallback }, null, 2)
        }],
        isError: true
      }
    }
    if (!peers.some(p => p.peer === peer)) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ok: false,
            reason: 'no_peer_visible',
            visible_peers: peers.map(p => p.peer),
            hint: 'Make sure the iPad is on the same Wi-Fi network and that Settings → cloud → multipeer toggle is on.'
          }, null, 2)
        }],
        isError: true
      }
    }

    const result = await pairPeer(peer, code)
    if (result.ok) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ok: true,
            peer: result.peer,
            message: `Paired with "${result.peer}". Future create_notebook calls will deliver directly via multipeer when this iPad is reachable.`
          }, null, 2)
        }]
      }
    }
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          ok: false,
          reason: result.reason,
          detail: result.detail
        }, null, 2)
      }],
      isError: true
    }
  }
}
