import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-helpers'
import { deleteMediaFile } from '@/lib/file-storage'

// DELETE /api/characters/[id] - Delete a character
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const { id: characterId } = await params

    const character = await db.character.findUnique({
      where: { id: characterId },
    })

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Delete associated images from file storage
    if (character.imageUrl) {
      await deleteMediaFile(character.imageUrl).catch(() => {})
    }

    // Delete all appearances and their images
    const appearances = await db.characterAppearance.findMany({
      where: { characterId },
    })

    for (const appearance of appearances) {
      if (appearance.imageUrl) {
        await deleteMediaFile(appearance.imageUrl).catch(() => {})
      }
      const urls: string[] = JSON.parse(appearance.imageUrls || '[]')
      for (const url of urls) {
        await deleteMediaFile(url).catch(() => {})
      }
    }

    // Delete appearances (cascade should handle this but explicit is safer)
    await db.characterAppearance.deleteMany({
      where: { characterId },
    })

    // Delete the character
    await db.character.delete({
      where: { id: characterId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete character:', error)
    return NextResponse.json({ error: 'Failed to delete character' }, { status: 500 })
  }
}
