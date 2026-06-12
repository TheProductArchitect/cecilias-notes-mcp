#!/usr/bin/env node
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  CONTAINER_ROOT,
  INBOX_ROOT,
  MCP_NOTEBOOKS_ROOT,
  iCloudAvailable
} from './lib/icloud'

const CLAUDE_DESKTOP_CONFIG = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Claude',
  'claude_desktop_config.json'
)

const MCP_ENTRY = { command: 'cecilias-notes-mcp' }

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function patchClaudeDesktop(): 'added' | 'already' | 'missing' {
  if (!fs.existsSync(CLAUDE_DESKTOP_CONFIG)) return 'missing'
  let config: Record<string, any>
  try {
    config = JSON.parse(fs.readFileSync(CLAUDE_DESKTOP_CONFIG, 'utf-8'))
  } catch {
    return 'missing'
  }
  if (config?.mcpServers?.['cecilias-notes']) return 'already'
  config.mcpServers = config.mcpServers ?? {}
  config.mcpServers['cecilias-notes'] = MCP_ENTRY
  fs.writeFileSync(CLAUDE_DESKTOP_CONFIG, JSON.stringify(config, null, 2), 'utf-8')
  return 'added'
}

function printClientSnippets(): void {
  console.log('\nOther MCP clients — copy-paste:')
  console.log('\n  Claude Code (terminal):')
  console.log('    claude mcp add cecilias-notes -- cecilias-notes-mcp')

  console.log('\n  Cursor — add to ~/.cursor/mcp.json:')
  console.log(JSON.stringify(
    { mcpServers: { 'cecilias-notes': MCP_ENTRY } },
    null, 2
  ).replace(/^/gm, '    '))

  console.log('\n  Windsurf — add to ~/.codeium/windsurf/mcp_config.json:')
  console.log(JSON.stringify(
    { mcpServers: { 'cecilias-notes': MCP_ENTRY } },
    null, 2
  ).replace(/^/gm, '    '))
  console.log('')
}

function run() {
  console.log('\ncecilias-notes-mcp setup\n')

  if (process.platform !== 'darwin') {
    console.error('✗ This tool requires macOS.')
    process.exit(1)
  }
  console.log('✓ macOS detected')

  if (!iCloudAvailable()) {
    console.error(`✗ iCloud container not found at:`)
    console.error(`  ${CONTAINER_ROOT}`)
    console.error('')
    console.error('  Please ensure:')
    console.error('  1. iCloud Drive is enabled in System Settings')
    console.error('  2. Cecilia\'s Notes is installed on your iPad')
    console.error('  3. Both devices use the same Apple ID')
    console.error('  4. iCloud Drive has synced at least once')
    process.exit(1)
  }
  console.log(`✓ iCloud container found`)
  console.log(`  ${CONTAINER_ROOT}`)

  ensureDir(INBOX_ROOT)
  console.log(`✓ Inbox ready (MCP writes here)`)
  console.log(`  ${INBOX_ROOT}`)

  ensureDir(MCP_NOTEBOOKS_ROOT)
  console.log(`✓ MCP notebooks mirror ready (MCP reads here)`)
  console.log(`  ${MCP_NOTEBOOKS_ROOT}`)

  const status = patchClaudeDesktop()
  if (status === 'added') {
    console.log('✓ Added to Claude Desktop config')
  } else if (status === 'already') {
    console.log('✓ Already configured in Claude Desktop')
  } else {
    console.log('• Claude Desktop config not found — skipping Claude Desktop entry')
  }

  printClientSnippets()

  console.log('✓ Setup complete.')
  console.log('  Restart any running MCP clients to pick up the change.\n')
  console.log('  Try asking your model:')
  console.log('  "Create a notebook called Quick Test in the Ideas subject"\n')
}

run()
