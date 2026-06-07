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

const CLAUDE_CONFIG_PATH = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Claude',
  'claude_desktop_config.json'
)

const MCP_ENTRY = {
  command: 'cecilias-notes-mcp'
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
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

  if (!fs.existsSync(CLAUDE_CONFIG_PATH)) {
    console.log('\n  Claude Desktop config not found.')
    console.log('  Add this to your MCP config manually:\n')
    console.log(JSON.stringify(
      { mcpServers: { 'cecilias-notes': MCP_ENTRY } },
      null, 2
    ))
    console.log('')
    return
  }

  let config: Record<string, any> = {}
  try {
    config = JSON.parse(fs.readFileSync(CLAUDE_CONFIG_PATH, 'utf-8'))
  } catch {
    console.error('✗ Could not parse Claude Desktop config.')
    console.error(`  File: ${CLAUDE_CONFIG_PATH}`)
    process.exit(1)
  }

  if (config?.mcpServers?.['cecilias-notes']) {
    console.log('✓ Already configured in Claude Desktop')
  } else {
    config.mcpServers = config.mcpServers ?? {}
    config.mcpServers['cecilias-notes'] = MCP_ENTRY
    fs.writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
    console.log('✓ Added to Claude Desktop config')
  }

  console.log('\n✓ Setup complete.')
  console.log('  Restart Claude Desktop to activate.\n')
  console.log('  Try asking Claude:')
  console.log('  "Create a notebook called Quick Test in the Ideas subject"\n')
}

run()
