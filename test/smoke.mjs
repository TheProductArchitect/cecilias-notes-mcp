#!/usr/bin/env node
// Smoke + contract test: spawn the built server over stdio, exercise the
// tools that affect subject routing, and assert the .inkbook payloads.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_PATH = join(__dirname, '..', 'dist', 'index.js')

const EXPECTED_TOOLS = [
  'create_notebook',
  'append_to_notebook',
  'list_notebooks',
  'list_subjects',
  'read_notebook',
  'search_notes',
  'delete_notebook'
]

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }
const pass = (msg) => console.log(`✓ ${msg}`)

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function readInkbooksFromInbox(container) {
  const inbox = join(container, 'Inbox')
  return readdirSync(inbox)
    .filter(f => f.endsWith('.inkbook'))
    .map(f => JSON.parse(readFileSync(join(inbox, f), 'utf-8')))
}

async function withFreshServer(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'cecilias-notes-mcp-smoke-'))
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: { ...process.env, CECILIAS_NOTES_CONTAINER: tmp }
  })
  const client = new Client(
    { name: 'cecilias-notes-mcp-smoke', version: '0.0.0' },
    { capabilities: {} }
  )
  try {
    await client.connect(transport)
    return await fn({ client, tmp })
  } finally {
    try { await client.close() } catch {}
    try { rmSync(tmp, { recursive: true, force: true }) } catch {}
  }
}

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args })
  const block = result.content?.[0]
  if (!block || block.type !== 'text') fail(`${name} returned no text content`)
  try {
    return JSON.parse(block.text)
  } catch {
    return { _raw: block.text }
  }
}

// ── Test 1: tools/list returns all 7 tools, each with an object inputSchema. ──
await withFreshServer(async ({ client }) => {
  const { tools } = await client.listTools()
  const names = tools.map(t => t.name).sort()
  const expected = [...EXPECTED_TOOLS].sort()
  if (!deepEqual(names, expected)) {
    fail(`tool set mismatch.\n  expected: ${expected.join(', ')}\n  got:      ${names.join(', ')}`)
  }
  pass(`all 7 tools registered: ${names.join(', ')}`)

  for (const tool of tools) {
    if (!tool.inputSchema || tool.inputSchema.type !== 'object') {
      fail(`tool ${tool.name} missing object inputSchema`)
    }
  }
  pass('every tool has an object inputSchema')

  const createTool = tools.find(t => t.name === 'create_notebook')
  if (createTool.inputSchema.required?.includes('subject')) {
    fail('create_notebook still marks subject as required; it must be optional now')
  }
  pass('create_notebook makes subject optional')
})

// ── Test 2: explicit subject round-trips into the .inkbook JSON. ─────────────
await withFreshServer(async ({ client, tmp }) => {
  const result = await callTool(client, 'create_notebook', {
    title: 'Kant on Phenomena',
    subject: 'philosophy',
    pages: [[{ type: 'paragraph', content: 'Critique of pure reason notes.' }]]
  })
  if (!result.success) fail(`create_notebook failed: ${JSON.stringify(result)}`)
  if (result.subject !== 'philosophy') {
    fail(`expected subject "philosophy" in response, got ${JSON.stringify(result.subject)}`)
  }

  const [notebook] = readInkbooksFromInbox(tmp)
  if (notebook.subject !== 'philosophy') {
    fail(`expected JSON subject "philosophy", got ${JSON.stringify(notebook.subject)}`)
  }
  pass('explicit subject="philosophy" round-trips verbatim into the .inkbook JSON')
})

// ── Test 3: omitted subject defaults to "inbox". ─────────────────────────────
await withFreshServer(async ({ client, tmp }) => {
  const result = await callTool(client, 'create_notebook', {
    title: 'Random thoughts',
    pages: [[{ type: 'paragraph', content: 'Stray idea.' }]]
  })
  if (!result.success) fail(`create_notebook failed: ${JSON.stringify(result)}`)
  if (result.subject !== 'inbox') {
    fail(`expected default subject "inbox", got ${JSON.stringify(result.subject)}`)
  }

  const [notebook] = readInkbooksFromInbox(tmp)
  if (notebook.subject !== 'inbox') {
    fail(`expected JSON subject "inbox", got ${JSON.stringify(notebook.subject)}`)
  }
  pass('omitted subject defaults to "inbox" in both response and on-disk JSON')
})

// ── Test 4: list_subjects reflects what is already on disk. ──────────────────
await withFreshServer(async ({ client }) => {
  // Seed two subjects: physics and math.
  await callTool(client, 'create_notebook', {
    title: 'Newton I',
    subject: 'physics',
    pages: [[{ type: 'paragraph', content: 'Inertia.' }]]
  })
  await callTool(client, 'create_notebook', {
    title: 'Newton II',
    subject: 'physics',
    pages: [[{ type: 'paragraph', content: 'F = ma.' }]]
  })
  await callTool(client, 'create_notebook', {
    title: 'Modular arithmetic',
    subject: 'math',
    pages: [[{ type: 'paragraph', content: 'Equivalence classes.' }]]
  })

  const subjects = await callTool(client, 'list_subjects', {})
  if (!Array.isArray(subjects.subjects) || subjects.subjects.length === 0) {
    fail(`list_subjects returned no subjects: ${JSON.stringify(subjects)}`)
  }
  const byName = Object.fromEntries(subjects.subjects.map(s => [s.subject, s.count]))
  if (byName.physics !== 2 || byName.math !== 1) {
    fail(`expected {physics:2, math:1}, got ${JSON.stringify(byName)}`)
  }
  // physics should outrank math.
  if (subjects.subjects[0].subject !== 'physics') {
    fail(`expected physics first (highest count), got ${subjects.subjects[0].subject}`)
  }
  pass('list_subjects reflects subjects + counts from on-disk notebooks (physics:2, math:1)')

  // The data the model needs to make the "Newton's Laws → physics" routing
  // decision is now first-class. The decision itself is a model-behaviour
  // assertion — not testable here, but the contract is met.
})

console.log('\n✓ all checks passed')
process.exit(0)
