import { db } from '@/lib/db'
import { aiClient, AI_SYSTEM_PROMPTS } from '@/lib/ai-config'
import { requireDramaAccess, type PlatformActor } from '@/lib/platform/access'
import { PlatformError } from '@/lib/platform/errors'

function aiClientForUser(userId: string) {
  return { ...aiClient, _userId: userId }
}

export async function rewriteEpisodeScript(actor: PlatformActor, episodeId: string) {
  const episode = await db.episode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      dramaId: true,
      rawContent: true,
      scriptStatus: true,
    },
  })

  if (!episode) {
    throw new PlatformError('NOT_FOUND', 'Episode not found', 404)
  }
  await requireDramaAccess(actor, episode.dramaId, 'write')

  if (!episode.rawContent?.trim()) {
    throw new PlatformError('BAD_REQUEST', 'Episode has no raw content', 400)
  }
  if (episode.scriptStatus === 'processing') {
    throw new PlatformError('CONFLICT', 'Episode script is already being rewritten', 409)
  }

  await db.episode.update({
    where: { id: episodeId },
    data: { scriptStatus: 'processing' },
  })

  try {
    const scriptContent = await aiClientForUser(actor.userId).chat(
      episode.rawContent,
      AI_SYSTEM_PROMPTS.SCRIPT_REWRITE,
      { temperature: 0.7, max_tokens: 8192 }
    )

    const updated = await db.episode.update({
      where: { id: episodeId },
      data: { scriptContent, scriptStatus: 'completed' },
      select: {
        id: true,
        dramaId: true,
        episodeNumber: true,
        title: true,
        scriptContent: true,
        scriptStatus: true,
        updatedAt: true,
      },
    })

    return updated
  } catch (error) {
    await db.episode.update({
      where: { id: episodeId },
      data: { scriptStatus: 'failed' },
    })
    throw error
  }
}
