#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { toolRegistry } from './tools/index'
import { iCloudAvailable, CONTAINER_ROOT } from './lib/icloud'

const pkg = require('../package.json')

const server = new Server(
  { name: 'cecilias-notes-mcp', version: pkg.version },
  { capabilities: { tools: {} } }
)

if (!iCloudAvailable()) {
  process.stderr.write(
    [
      '',
      '  cecilias-notes-mcp: iCloud container not found.',
      '',
      '  Required:',
      '    1. macOS with iCloud Drive enabled',
      '    2. Cecilia\'s Notes installed on your iPad',
      '    3. Both devices signed in to the same Apple ID',
      '    4. iCloud Drive synced at least once',
      '',
      `  Expected: ${CONTAINER_ROOT}/`,
      ''
    ].join('\n')
  )
  process.exit(1)
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
