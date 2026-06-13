import { db } from '@/lib/db'
import {
  accessibleDramaWhere,
  requireDramaAccess,
  type PlatformActor,
} from '@/lib/platform/access'
import { PlatformError } from '@/lib/platform/errors'

export async function listAccessibleDramas(actor: PlatformActor) {
  return db.drama.findMany({
    where: accessibleDramaWhere(actor),
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      description: true,
      genre: true,
      style: true,
      status: true,
      updatedAt: true,
      _count: {
        select: { episodes: true, characters: true, scenes: true },
      },
    },
  })
}

export async function listAccessibleEpisodes(actor: PlatformActor, dramaId: string) {
  await requireDramaAccess(actor, dramaId)
  return db.episode.findMany({
    where: { dramaId },
    orderBy: { episodeNumber: 'asc' },
    select: {
      id: true,
      dramaId: true,
      episodeNumber: true,
      title: true,
      status: true,
      scriptStatus: true,
      storyboardStatus: true,
      updatedAt: true,
      _count: { select: { storyboards: true } },
    },
  })
}

export async function getAccessibleEpisode(actor: PlatformActor, episodeId: string) {
  const episode = await db.episode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      dramaId: true,
      episodeNumber: true,
      title: true,
      rawContent: true,
      scriptContent: true,
      scriptStatus: true,
      storyboardStatus: true,
      status: true,
      updatedAt: true,
      drama: { select: { id: true, title: true } },
      _count: { select: { storyboards: true } },
    },
  })

  if (!episode) {
    throw new PlatformError('NOT_FOUND', 'Episode not found', 404)
  }
  await requireDramaAccess(actor, episode.dramaId)
  return episode
}
