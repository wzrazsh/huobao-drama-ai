import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { aiClient, getActiveProviderForUser } from '@/lib/ai-config'
import { requireAuth } from '@/lib/auth-helpers'
import { saveMediaFile } from '@/lib/file-storage'
import { resolveCharacterReferencesForMiniMax } from '@/lib/cos-storage'
import {
  buildSceneContentPrompt,
  collectSceneGenerationContext,
  isPublicReferenceUrl,
} from '@/lib/scene-generation-context'

// POST /api/ai/generate-scene-image - AI Generate Scene Image
// Generates an image from a scene's prompt and saves it to the scene record
// Updated: supports referenceImages, creates SceneImage record
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    aiClient._userId = auth.userId
    const { sceneId, style, referenceImages } = await request.json() as {
      sceneId: string
      style?: string
      referenceImages?: string[]
    }

    if (!sceneId) {
      return NextResponse.json(
        { error: 'sceneId is required' },
        { status: 400 }
      )
    }

    // Get scene
    const scene = await db.scene.findUnique({
      where: { id: sceneId },
    })

    if (!scene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 })
    }

    // Build prompt from scene info
    const baseScenePrompt = scene.prompt || [
      'Cinematic establishing shot,',
      style ? `${style} style,` : '',
      scene.location,
      scene.timeOfDay ? `${scene.timeOfDay} lighting,` : '',
      scene.description,
      'professional cinematography, high quality, film still',
    ].filter(Boolean).join(' ')
    const contentContext = await collectSceneGenerationContext(scene)
    const scenePrompt = buildSceneContentPrompt(baseScenePrompt, contentContext)

    if (!scenePrompt.trim()) {
      return NextResponse.json(
        { error: 'Scene has no prompt or description to generate image from' },
        { status: 400 }
      )
    }
    const negativePrompt =
      'blurry, low quality, amateur, watermark, text overlay, duplicate person, extra limbs, malformed hands'
    const provider = await getActiveProviderForUser('image', auth.userId)

    // Load relevant characters to map reference images to COS URLs for MiniMax.
    const characters = await db.character.findMany({
      where: { dramaId: scene.dramaId },
      include: { appearances: true },
    })
    const characterByImageUrl = new Map<string, typeof characters[number]>()
    for (const character of characters) {
      if (character.imageUrl) characterByImageUrl.set(character.imageUrl, character)
      if (character.cosImageUrl) characterByImageUrl.set(character.cosImageUrl, character)
      for (const appearance of character.appearances || []) {
        if (appearance.imageUrl) characterByImageUrl.set(appearance.imageUrl, character)
        if (appearance.cosImageUrl) characterByImageUrl.set(appearance.cosImageUrl, character)
      }
    }

    const collectedReferences = [
      ...contentContext.characterReferenceImages,
      ...contentContext.propReferenceImages,
      ...(referenceImages || []),
    ]

    let providerReferences: string[] = collectedReferences
    if (provider?.provider === 'minimax') {
      // MiniMax requires public HTTP URLs for subject_reference.
      // Convert local file-storage URLs to Tencent COS public URLs.
      const characterRefs = contentContext.characterReferenceImages
        .map((url) => {
          const character = characterByImageUrl.get(url)
          return character
            ? { id: character.id, imageUrl: character.imageUrl, cosImageUrl: character.cosImageUrl }
            : { id: 'unknown', imageUrl: url, cosImageUrl: null }
        })
        .filter((ref): ref is { id: string; imageUrl: string | null; cosImageUrl: string | null } =>
          Boolean(ref.imageUrl || ref.cosImageUrl)
        )
      const { urls: cosUrls, uploaded } = await resolveCharacterReferencesForMiniMax(characterRefs)

      // Persist newly-uploaded COS URLs back to the character records for future reuse.
      for (const item of uploaded) {
        if (item.id === 'unknown') continue
        const character = characters.find((c) => c.id === item.id)
        if (!character) continue
        if (!character.cosImageUrl) {
          await db.character.update({
            where: { id: item.id },
            data: { cosImageUrl: item.url },
          })
        }
      }

      // Keep any already-public prop/character URLs that are not local.
      const otherPublicUrls = collectedReferences
        .filter((url) => !contentContext.characterReferenceImages.includes(url))
        .filter((url) => isPublicReferenceUrl(url, request.nextUrl.origin))
        .map((url) => new URL(url, request.nextUrl.origin).toString())

      providerReferences = [...cosUrls, ...otherPublicUrls]
    }

    // Generate scene image with optional reference images
    let base64Image: string
    try {
      base64Image = await aiClient.generateImage(scenePrompt, negativePrompt, {
        width: 1280,
        height: 720,
        referenceImages: Array.from(new Set(providerReferences)).slice(0, 4),
      })
    } catch (error: unknown) {
      // Handle async task — return taskId for client-side polling
      if (error instanceof Error && error.name === 'AsyncTaskError' && error.message.startsWith('ASYNC_TASK:')) {
        const taskId = error.message.replace('ASYNC_TASK:', '')
        return NextResponse.json({
          status: 'processing',
          taskId,
          category: 'image',
          sceneId,
          message: '场景图生成中，请稍后查询',
        })
      }
      throw error
    }

    // Save image to file storage instead of base64 data URL
    const saveResult = await saveMediaFile(base64Image, {
      mimeType: 'image/png',
      category: 'scenes',
      dramaId: scene.dramaId,
      filename: `scene_${sceneId}_${Date.now()}`,
    })
    const imageUrl = saveResult.url

    // Save imageUrl to scene record
    const updatedScene = await db.scene.update({
      where: { id: sceneId },
      data: { imageUrl },
    })

    // Create a SceneImage record
    const sceneImage = await db.sceneImage.create({
      data: {
        sceneId,
        description: scenePrompt,
        imageUrl,
        timeOfDay: scene.timeOfDay || '',
        angle: 'wide',
        isSelected: false,
      },
    })

    // If no other image is selected for this scene, auto-select this one
    const selectedCount = await db.sceneImage.count({
      where: { sceneId, isSelected: true },
    })
    if (selectedCount === 0) {
      await db.sceneImage.update({
        where: { id: sceneImage.id },
        data: { isSelected: true },
      })
    }

    return NextResponse.json({
      scene: updatedScene,
      imageUrl,
      sceneImage,
      references: {
        characters: contentContext.characterNames,
        props: contentContext.propNames,
      },
    })
  } catch (error) {
    console.error('Failed to generate scene image:', error)
    const message = error instanceof Error ? error.message : 'Failed to generate scene image'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
