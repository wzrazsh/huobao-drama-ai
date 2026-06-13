import path from 'node:path'
import process from 'node:process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.join(process.cwd(), 'scripts', 'mcp', 'huobao-server.ts'),
    ],
    cwd: process.cwd(),
    stderr: 'pipe',
  })
  transport.stderr?.on('data', (chunk) => process.stderr.write(chunk))

  const client = new Client({ name: 'huobao-mcp-smoke-test', version: '1.0.0' })
  await client.connect(transport)

  const tools = await client.listTools()
  const expected = [
    'list_dramas',
    'list_episodes',
    'get_episode',
    'rewrite_script',
    'generate_image',
    'regenerate_character_view',
    'get_generation_status',
  ]
  const names = tools.tools.map((tool) => tool.name)
  for (const name of expected) {
    if (!names.includes(name)) throw new Error(`Missing MCP tool: ${name}`)
  }

  const dramas = await client.callTool({ name: 'list_dramas', arguments: {} })
  if (dramas.isError) throw new Error(`list_dramas failed: ${JSON.stringify(dramas.content)}`)

  console.log(JSON.stringify({ tools: names, listDramas: 'ok' }, null, 2))
  await transport.close()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
