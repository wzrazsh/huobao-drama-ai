import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// stdout is reserved for MCP JSON-RPC. Application modules log during import.
console.log = (...args: unknown[]) => console.error(...args)

const appUrl = (
  process.env.HUOBAO_APP_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'http://localhost:3000'
).replace(/\/$/, '')

function withAbsoluteUrl<T extends Record<string, unknown>>(value: T): T {
  const imageUrl = value.imageUrl
  if (typeof imageUrl === 'string' && imageUrl.startsWith('/')) {
    return { ...value, imageUrl: `${appUrl}${imageUrl}` }
  }
  return value
}

function toolResult(value: unknown) {
  const structuredContent =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : { value }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent,
  }
}

function toolError(error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'INTERNAL_ERROR'
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: message, code }, null, 2),
      },
    ],
    structuredContent: { error: message, code },
    isError: true,
  }
}

async function main() {
  const [
    { requireActiveUserByEmail },
    projectService,
    scriptService,
    imageService,
    characterViewService,
    { db },
  ] = await Promise.all([
    import('../../src/lib/platform/access'),
    import('../../src/lib/platform/project-service'),
    import('../../src/lib/platform/script-service'),
    import('../../src/lib/platform/image-service'),
    import('../../src/lib/platform/character-view-service'),
    import('../../src/lib/db'),
  ])

  const email = process.env.HUOBAO_MCP_USER_EMAIL || 'admin@huobao.com'
  const actor = await requireActiveUserByEmail(email)
  console.error(`[huobao-mcp] Acting as ${actor.email} (${actor.role})`)

  const server = new McpServer({
    name: 'huobao-drama-ai',
    version: '1.0.0',
  })

  server.registerTool(
    'list_dramas',
    {
      title: 'List drama projects',
      description: 'List drama projects accessible to the configured Huobao user.',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const dramas = await projectService.listAccessibleDramas(actor)
        return toolResult({ dramas })
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.registerTool(
    'list_episodes',
    {
      title: 'List drama episodes',
      description: 'List episodes in an accessible drama project.',
      inputSchema: z.object({
        dramaId: z.string().min(1).describe('Drama project ID'),
      }).strict(),
      annotations: { readOnlyHint: true },
    },
    async ({ dramaId }) => {
      try {
        const episodes = await projectService.listAccessibleEpisodes(actor, dramaId)
        return toolResult({ dramaId, episodes })
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.registerTool(
    'get_episode',
    {
      title: 'Get episode',
      description: 'Read an episode including raw source, rewritten script, and statuses.',
      inputSchema: z.object({
        episodeId: z.string().min(1).describe('Episode ID'),
      }).strict(),
      annotations: { readOnlyHint: true },
    },
    async ({ episodeId }) => {
      try {
        const episode = await projectService.getAccessibleEpisode(actor, episodeId)
        return toolResult({ episode })
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.registerTool(
    'rewrite_script',
    {
      title: 'Rewrite episode script',
      description: 'Rewrite an episode raw source into a screenplay and save it to Huobao.',
      inputSchema: z.object({
        episodeId: z.string().min(1).describe('Episode ID'),
      }).strict(),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ episodeId }) => {
      try {
        const episode = await scriptService.rewriteEpisodeScript(actor, episodeId)
        return toolResult({ episode })
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.registerTool(
    'generate_image',
    {
      title: 'Generate image',
      description:
        'Generate and store an image, optionally using drama, episode, storyboard, character, or scene context.',
      inputSchema: z.object({
        prompt: z.string().min(1).describe('Image generation prompt'),
        dramaId: z.string().min(1).optional(),
        episodeId: z.string().min(1).optional(),
        storyboardId: z.string().min(1).optional(),
        characterId: z.string().min(1).optional(),
        sceneId: z.string().min(1).optional(),
        size: z.string().regex(/^\d+x\d+$/).optional().describe('Image size, for example 1024x1024'),
        style: z.string().optional(),
        atmosphere: z.string().optional(),
        dialogueChar: z.string().optional(),
        sceneLocation: z.string().optional(),
        shotType: z.string().optional(),
        cameraAngle: z.string().optional(),
      }).strict(),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async (input) => {
      try {
        const result = await imageService.generatePlatformImage(actor, input)
        return toolResult(withAbsoluteUrl(result))
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.registerTool(
    'regenerate_character_view',
    {
      title: 'Regenerate character view',
      description:
        'Regenerate one standard character view and replace the matching CharacterAppearance image.',
      inputSchema: z.object({
        characterId: z.string().min(1).describe('Character ID'),
        viewLabel: z.enum(['面部特写', '全身正面', '全身背面', '全身侧面']),
        style: z.string().optional(),
        promptOverride: z.string().min(1).optional().describe(
          'Complete image prompt override for correcting identity, outfit, pose, or visual style'
        ),
      }).strict(),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async (input) => {
      try {
        const result = await characterViewService.regenerateCharacterView(actor, input)
        return toolResult(withAbsoluteUrl(result))
      } catch (error) {
        return toolError(error)
      }
    }
  )

  server.registerTool(
    'get_generation_status',
    {
      title: 'Get image generation status',
      description: 'Poll an asynchronous image generation task and store its completed image.',
      inputSchema: z.object({
        taskId: z.string().min(1).describe('Provider task ID returned by generate_image'),
        dramaId: z.string().min(1).optional().describe('Drama ID used for access checks and storage'),
      }).strict(),
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) => {
      try {
        const result = await imageService.pollPlatformImage(actor, input)
        return toolResult(withAbsoluteUrl(result))
      } catch (error) {
        return toolError(error)
      }
    }
  )

  const transport = new StdioServerTransport()
  const shutdown = async () => {
    await server.close().catch(() => undefined)
    await db.$disconnect().catch(() => undefined)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  await server.connect(transport)
}

main().catch((error) => {
  console.error('[huobao-mcp] Startup failed:', error)
  process.exitCode = 1
})
