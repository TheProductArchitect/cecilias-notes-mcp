#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { toolRegistry } from './tools/index'
import {
  iCloudAvailable,
  CONTAINER_ROOT,
  ICLOUD_MISSING_MESSAGE
} from './lib/icloud'

const pkg = require('../package.json')

function printHelp(): void {
  process.stdout.write(
    [
      `cecilias-notes-mcp v${pkg.version}`,
      '',
      'MCP server for Cecilia\'s Notes. Reads/writes .inkbook files in the app\'s',
      'iCloud container so any MCP-compatible AI agent can manage notebooks.',
      '',
      'Usage:',
      '  cecilias-notes-mcp           Start the MCP server on stdio.',
      '  cecilias-notes-mcp --version  Print version and exit.',
      '  cecilias-notes-mcp --help     Print this message and exit.',
      '',
      'Setup:',
      '  cecilias-notes-mcp-setup     Create iCloud dirs and configure MCP clients.',
      '',
      `Container: ${CONTAINER_ROOT}`,
      ''
    ].join('\n')
  )
}

const argv = process.argv.slice(2)
if (argv.includes('--version') || argv.includes('-v')) {
  process.stdout.write(`${pkg.version}\n`)
  process.exit(0)
}
if (argv.includes('--help') || argv.includes('-h')) {
  printHelp()
  process.exit(0)
}

const server = new Server(
  { name: 'cecilias-notes-mcp', version: pkg.version },
  { capabilities: { tools: {} } }
)

if (!iCloudAvailable()) {
  // Soft-fail: keep the server running so the model can surface a helpful error
  // through a tool call. Hard-exiting here shows up as an opaque "server failed
  // to connect" in most MCP clients.
  process.stderr.write(`\ncecilias-notes-mcp: ${ICLOUD_MISSING_MESSAGE}\n\n`)
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.values(toolRegistry).map(t => t.schema)
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = toolRegistry[request.params.name]

  if (!tool) {
    return {
      content: [{
        type: 'text' as const,
        text: `Unknown tool: "${request.params.name}". ` +
              `Available tools: ${Object.keys(toolRegistry).join(', ')}`
      }],
      isError: true
    }
  }

  return tool.handler(request.params.arguments ?? {})
})

const transport = new StdioServerTransport()
server.connect(transport).then(() => {
  process.stderr.write(`cecilias-notes-mcp v${pkg.version} running\n`)
})
