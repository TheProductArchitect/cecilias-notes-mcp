#!/usr/bin/env node
// Smoke test: spawn the built server over stdio and assert tools/list returns
// all six tools. Runs without iCloud by setting CECILIAS_NOTES_CONTAINER to a
// temp directory.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_PATH = join(__dirname, '..', 'dist', 'index.js')

const EXPECTED_TOOLS = [
  'create_notebook',
  'append_to_notebook',
  'list_notebooks',
  'read_notebook',
  'search_notes',
  'delete_notebook'
]

const tmp = mkdtempSync(join(tmpdir(), 'cecilias-notes-mcp-smoke-'))
process.on('exit', () => {
  try { rmSync(tmp, { recursive: true, force: true }) } catch {}
})

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [SERVER_PATH],
  env: { ...process.env, CECILIAS_NOTES_CONTAINER: tmp }
})

const client = new Client(
  { name: 'cecilias-notes-mcp-smoke', version: '0.0.0' },
  { capabilities: {} }
)

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }
const pass = (msg) => console.log(`✓ ${msg}`)

try {
  await client.connect(transport)
  pass('client connected and initialized')

  const { tools } = await client.listTools()
  if (!Array.isArray(tools)) fail('tools/list did not return an array')

  const names = tools.map(t => t.name).sort()
  const expected = [...EXPECTED_TOOLS].sort()
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    fail(`tool set mismatch.\n  expected: ${expected.join(', ')}\n  got:      ${names.join(', ')}`)
  }
  pass(`all 6 tools registered: ${names.join(', ')}`)

  for (const tool of tools) {
    if (!tool.inputSchema || tool.inputSchema.type !== 'object') {
      fail(`tool ${tool.name} missing object inputSchema`)
    }
  }
  pass('every tool has an object inputSchema')

  await client.close()
  pass('smoke test passed')
  process.exit(0)
} catch (err) {
  fail(`smoke test failed: ${err?.message ?? err}`)
}
