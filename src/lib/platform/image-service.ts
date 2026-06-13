import { aiClient, getActiveProviderForUser } from '@/lib/ai-config'
import { getImageAdapter } from '@/lib/adapters/image'
import { db } from '@/lib/db'
import { saveMediaFile } from '@/lib/file-storage'
import {
  buildConsistencyPrompt,
  buildEnhancedPrompt,
  collectCharacterReferences,
  collectSceneReferences,
  collectStoryboardReferences,
} from '@/lib/reference-collector'
import { calcImageCredits, recordGenerationCost } from '@/lib/cost-tracker'
import { requireDramaAccess, type PlatformActor } from '@/lib/platform/access'
import { PlatformError } from '@/lib/platform/errors'

export interface GeneratePlatformImageInput {
  prompt: string
  size?: string
  dramaId?: string
  episodeId?: string
  storyboardId?: string
  characterId?: string
  sceneId?: string
  atmosphere?: string
  dialogueChar?: string
  sceneLocation?: string
  shotType?: string
  cameraAngle?: string
  style?: string
}

export interface PollPlatformImageInput {
  taskId: string
  dramaId?: string
}

function aiClientForUser(userId: string) {
  return { ...aiClient, _userId: userId }
}

async function resolveImageContext(actor: PlatformActor, input: GeneratePlatformImageInput) {
  const foundDramaIds = new Set<string>()
  let storyboard:
    | {
        episodeId: string
        shotType: string
        cameraAngle: string
        atmosphere: string | null
        episode: { dramaId: string }
      }
    | null = null

  if (input.dramaId) foundDramaIds.add(input.dramaId)

  if (input.storyboardId) {
    storyboard = await db.storyboard.findUnique({
      where: { id: input.storyboardId },
      select: {
        episodeId: true,
        shotType: true,
        cameraAngle: true,
        atmosphere: true,
        episode: { select: { dramaId: true } },
      },
    })
    if (!storyboard) throw new PlatformError('NOT_FOUND', 'Storyboard not found', 404)
    foundDramaIds.add(storyboard.episode.dramaId)
  }

  if (input.episodeId) {
    const episode = await db.episode.findUnique({
      where: { id: input.episodeId },
      select: { dramaId: true },
    })
    if (!episode) throw new PlatformError('NOT_FOUND', 'Episode not found', 404)
    foundDramaIds.add(episode.dramaId)
  }

  if (input.characterId) {
    const character = await db.character.findUnique({
      where: { id: input.characterId },
      select: { dramaId: true },
    })
    if (!character) throw new PlatformError('NOT_FOUND', 'Character not found', 404)
    foundDramaIds.add(character.dramaId)
  }

  if (input.sceneId) {
    const scene = await db.scene.findUnique({
      where: { id: input.sceneId },
      select: { dramaId: true },
    })
    if (!scene) throw new PlatformError('NOT_FOUND', 'Scene not found', 404)
    foundDramaIds.add(scene.dramaId)
  }

  if (foundDramaIds.size > 1) {
    throw new PlatformError('BAD_REQUEST', 'Referenced resources belong to different dramas', 400)
  }

  const dramaId = [...foundDramaIds][0]
  if (dramaId) await requireDramaAccess(actor, dramaId, 'write')

  const episodeId = input.episodeId || storyboard?.episodeId
  return { dramaId, episodeId, storyboard }
}

export async function generatePlatformImage(
  actor: PlatformActor,
  input: GeneratePlatformImageInput
) {
  if (!input.prompt?.trim()) {
    throw new PlatformError('BAD_REQUEST', 'prompt is required', 400)
  }

  const startTime = Date.now()
  const imageSize = input.size || '1024x1024'
  const { dramaId, episodeId, storyboard } = await resolveImageContext(actor, input)
  const provider = await getActiveProviderForUser('image', actor.userId)
  if (!provider) {
    throw new PlatformError(
      'PROVIDER_NOT_CONFIGURED',
      'No image provider is configured for this user or the platform',
      400
    )
  }

  let dramaStyleTemplate = ''
  if (dramaId) {
    const drama = await db.drama.findUnique({
      where: { id: dramaId },
      select: { styleTemplate: true },
    })
    dramaStyleTemplate = drama?.styleTemplate || ''
  }

  let referenceImages: string[] = []
  let enhancedPrompt = input.prompt.trim()

  if (episodeId) {
    const refs = await collectStoryboardReferences(
      episodeId,
      input.dialogueChar,
      input.sceneLocation
    )
    referenceImages = refs.allImageUrls
    const hasStyleLocks =
      refs.characterImages.some((item) => item.styleLock) ||
      refs.sceneImages.some((item) => item.styleLock)
    if (hasStyleLocks) {
      enhancedPrompt = buildConsistencyPrompt(enhancedPrompt, refs, dramaStyleTemplate)
    } else if (input.storyboardId || input.atmosphere || storyboard?.atmosphere) {
      enhancedPrompt = buildEnhancedPrompt(enhancedPrompt, refs)
    }
  } else if (input.characterId) {
    referenceImages = await collectCharacterReferences(input.characterId)
  } else if (input.sceneId) {
    referenceImages = await collectSceneReferences(input.sceneId)
  }

  referenceImages = referenceImages.filter(
    (url) =>
      Boolean(url?.trim()) &&
      (url.startsWith('data:') || url.startsWith('http') || url.startsWith('/api/files/'))
  )

  const client = aiClientForUser(actor.userId)
  let base64Image: string

  try {
    if (input.storyboardId || input.atmosphere || episodeId) {
      base64Image = await client.generateStoryboardFrame(
        enhancedPrompt,
        input.atmosphere || storyboard?.atmosphere || undefined,
        input.shotType || storyboard?.shotType,
        input.cameraAngle || storyboard?.cameraAngle,
        input.style,
        referenceImages.length ? referenceImages : undefined
      )
    } else if (input.characterId) {
      base64Image = await client.generateCharacterPortrait(
        enhancedPrompt,
        input.style,
        undefined,
        undefined,
        referenceImages.length ? referenceImages : undefined
      )
    } else if (input.sceneId) {
      base64Image = await client.generateSceneImage(
        enhancedPrompt,
        undefined,
        input.style,
        undefined,
        referenceImages.length ? referenceImages : undefined
      )
    } else {
      base64Image = await client.generateImage(
        enhancedPrompt,
        'blurry, low quality, distorted, watermark, text overlay',
        {
          size: imageSize,
          referenceImages: referenceImages.length ? referenceImages : undefined,
        }
      )
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'AsyncTaskError' &&
      error.message.startsWith('ASYNC_TASK:')
    ) {
      const taskId = error.message.slice('ASYNC_TASK:'.length)
      if (dramaId) {
        recordGenerationCost({
          dramaId,
          episodeId,
          category: 'image',
          provider: provider.provider,
          model: provider.model,
          credits: calcImageCredits(imageSize),
          generationMs: Date.now() - startTime,
        })
      }
      return {
        status: 'processing' as const,
        taskId,
        category: 'image' as const,
        dramaId,
        message: 'Image generation is processing; poll with the returned taskId.',
        prompt: enhancedPrompt,
        referenceCount: referenceImages.length,
      }
    }
    throw error
  }

  const category = input.characterId ? 'characters' : input.sceneId ? 'scenes' : 'storyboards'
  const saved = await saveMediaFile(base64Image, {
    mimeType: 'image/png',
    category,
    dramaId,
    filename: `img_${Date.now()}`,
  })

  if (dramaId) {
    recordGenerationCost({
      dramaId,
      episodeId,
      category: 'image',
      provider: provider.provider,
      model: provider.model,
      credits: calcImageCredits(imageSize),
      generationMs: Date.now() - startTime,
    })
  }

  return {
    status: 'completed' as const,
    imageUrl: saved.url,
    dramaId,
    prompt: enhancedPrompt,
    referenceCount: referenceImages.length,
  }
}

export async function pollPlatformImage(
  actor: PlatformActor,
  input: PollPlatformImageInput
) {
  if (!input.taskId?.trim()) {
    throw new PlatformError('BAD_REQUEST', 'taskId is required', 400)
  }
  if (input.dramaId) {
    await requireDramaAccess(actor, input.dramaId, 'write')
  }

  const provider = await getActiveProviderForUser('image', actor.userId)
  if (!provider) {
    throw new PlatformError(
      'PROVIDER_NOT_CONFIGURED',
      'No image provider is configured for this user or the platform',
      400
    )
  }

  const adapter = getImageAdapter(provider.provider)
  const config = {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.model,
  }
  const request = adapter.buildPollRequest(config, input.taskId)
  if (!request) {
    throw new PlatformError(
      'BAD_REQUEST',
      'The active image provider does not support task polling',
      400
    )
  }

  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new PlatformError(
      'GENERATION_FAILED',
      `Image polling failed (${response.status}): ${detail.slice(0, 300)}`,
      502
    )
  }

  const parsed = adapter.parsePollResponse(await response.json())
  if (parsed.status !== 'completed') {
    return { status: parsed.status, error: parsed.error }
  }

  let imageData: Buffer | string | undefined
  if (parsed.imageUrl) {
    const imageResponse = await fetch(parsed.imageUrl)
    if (!imageResponse.ok) {
      throw new PlatformError('GENERATION_FAILED', 'Generated image download failed', 502)
    }
    imageData = Buffer.from(await imageResponse.arrayBuffer())
  } else if (parsed.imageBase64) {
    imageData = parsed.imageBase64
  }

  if (!imageData) {
    throw new PlatformError('GENERATION_FAILED', 'Generation completed without image data', 502)
  }

  const saved = await saveMediaFile(imageData, {
    mimeType: 'image/png',
    category: 'storyboards',
    dramaId: input.dramaId,
    filename: `async_img_${Date.now()}`,
  })

  return { status: 'completed' as const, imageUrl: saved.url }
}
