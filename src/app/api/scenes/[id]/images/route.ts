import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { aiClient } from '@/lib/ai-config'
import { saveMediaFile } from '@/lib/file-storage'
import {
  buildSceneContentPrompt,
  collectSceneGenerationContext,
} from '@/lib/scene-generation-context'
// GET /api/scenes/[id]/images - List all images for a scene
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sceneId } = await params

    const scene = await db.scene.findUnique({
      where: { id: sceneId },
    })

    if (!scene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 })
    }

    const images = await db.sceneImage.findMany({
      where: { sceneId },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ images })
  } catch (error) {
    console.error('Failed to list scene images:', error)
    return NextResponse.json({ error: 'Failed to list scene images' }, { status: 500 })
  }
}

// POST /api/scenes/[id]/images - Create/generate a scene reference image
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sceneId } = await params

    const scene = await db.scene.findUnique({
      where: { id: sceneId },
    })

    if (!scene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 })
    }

    const body = await request.json()
    const { timeOfDay, angle, description, generateImage, style, referenceImages } = body as {
      timeOfDay?: string
      angle?: string
      description?: string
      generateImage?: boolean
      style?: string
      referenceImages?: string[]
    }

    let imageUrl: string | null = null
    let finalDescription = description || ''

    if (generateImage) {
      // Build scene prompt
      const baseScenePrompt = scene.prompt || finalDescription || [
        'Cinematic establishing shot,',
        style ? `${style} style,` : '',
        scene.location,
        timeOfDay || scene.timeOfDay ? `${timeOfDay || scene.timeOfDay} lighting,` : '',
        scene.description,
        'professional cinematography, high quality, film still',
      ].filter(Boolean).join(' ')
      const contentContext = await collectSceneGenerationContext(scene)
      const scenePrompt = buildSceneContentPrompt(baseScenePrompt, contentContext)

      const negativePrompt =
        'blurry, low quality, amateur, cartoon, anime, watermark, text overlay'

      const base64Image = await aiClient.generateImage(scenePrompt, negativePrompt, {
        width: 1280,
        height: 720,
        referenceImages: Array.from(new Set([
          ...contentContext.characterReferenceImages,
          ...contentContext.propReferenceImages,
          ...(referenceImages || []),
        ])).slice(0, 4),
      })

      // Save to file storage instead of base64 data URL
      const saveResult = await saveMediaFile(base64Image, {
        mimeType: 'image/png',
        category: 'scenes',
        dramaId: scene.dramaId,
        filename: `scene_${sceneId}_${Date.now()}`,
      })
      imageUrl = saveResult.url
      if (!finalDescription) {
        finalDescription = scenePrompt
      }
    }

    const sceneImage = await db.sceneImage.create({
      data: {
        sceneId,
        description: finalDescription,
        imageUrl,
        timeOfDay: timeOfDay || scene.timeOfDay || '',
        angle: angle || 'wide',
        isSelected: false,
      },
    })

    // If this is the first image for this scene or no selected image, auto-select it
    const selectedCount = await db.sceneImage.count({
      where: { sceneId, isSelected: true },
    })
    if (selectedCount === 0 && imageUrl) {
      await db.sceneImage.update({
        where: { id: sceneImage.id },
        data: { isSelected: true },
      })
      // Also update scene's imageUrl
      await db.scene.update({
        where: { id: sceneId },
        data: { imageUrl },
      })
    }

    return NextResponse.json(sceneImage, { status: 201 })
  } catch (error) {
    console.error('Failed to create scene image:', error)
    const message = error instanceof Error ? error.message : 'Failed to create scene image'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
