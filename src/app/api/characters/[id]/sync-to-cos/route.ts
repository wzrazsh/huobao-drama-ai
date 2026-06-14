import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-helpers'
import {
  uploadCharacterImageToCos,
  uploadAppearanceImageToCos,
} from '@/lib/cos-storage'

interface SyncResult {
  characterId: string
  cosImageUrl: string | null
  appearances: Array<{
    appearanceId: string
    appearanceIndex: number
    cosImageUrl: string | null
  }>
}

// POST /api/characters/[id]/sync-to-cos
// Uploads the character's local images to Tencent COS and stores public URLs.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const { id: characterId } = await params

    const character = await db.character.findUnique({
      where: { id: characterId },
      include: { appearances: true },
    })

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    const result: SyncResult = {
      characterId,
      cosImageUrl: character.cosImageUrl,
      appearances: [],
    }

    // Sync main character image
    if (character.imageUrl && !character.cosImageUrl) {
      try {
        const upload = await uploadCharacterImageToCos(characterId, character.imageUrl)
        await db.character.update({
          where: { id: characterId },
          data: { cosImageUrl: upload.url },
        })
        result.cosImageUrl = upload.url
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[SyncToCos] Failed to upload character ${characterId} main image:`, message)
      }
    }

    // Sync appearance images
    for (const appearance of character.appearances) {
      let cosImageUrl: string | null = appearance.cosImageUrl
      if (appearance.imageUrl && !appearance.cosImageUrl) {
        try {
          const upload = await uploadAppearanceImageToCos(
            characterId,
            appearance.appearanceIndex,
            appearance.imageUrl
          )
          await db.characterAppearance.update({
            where: { id: appearance.id },
            data: { cosImageUrl: upload.url },
          })
          cosImageUrl = upload.url
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.error(
            `[SyncToCos] Failed to upload appearance ${appearance.id} for character ${characterId}:`,
            message
          )
        }
      }
      result.appearances.push({
        appearanceId: appearance.id,
        appearanceIndex: appearance.appearanceIndex,
        cosImageUrl,
      })
    }

    return NextResponse.json({
      success: true,
      result,
      message: '角色图片已同步到云端',
    })
  } catch (error) {
    console.error('Failed to sync character images to COS:', error)
    const message = error instanceof Error ? error.message : 'Failed to sync character images to COS'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
