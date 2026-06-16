// ============================================================
// POST /api/upload — Generic media file upload
//
// Accepts a multipart/form-data payload with:
//   - file:         the media file (required)
//   - storyboardId: link upload to a Storyboard (mutually exclusive with characterId/sceneId)
//   - characterId:  link upload to a Character
//   - sceneId:      link upload to a Scene
//   - fieldType:    which field on the linked entity to update
//                   (firstFrameUrl | lastFrameUrl | videoUrl | ttsAudioUrl | imageUrl)
//
// On success, the file is persisted via the project's file-storage
// abstraction and the linked database record is updated. The response
// shape matches what src/lib/api.ts:1248 declares as the contract for
// api.upload.file(): { url, storyboard?, character?, scene? }.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { saveMediaFile } from '@/lib/file-storage'

// Run on the Node.js runtime — file-storage uses fs/promises.
export const runtime = 'nodejs'

// ----- Limits & MIME allow-lists -----

const MAX_SIZE: Record<string, number> = {
  image: 20 * 1024 * 1024, // 20MB
  video: 200 * 1024 * 1024, // 200MB
  audio: 20 * 1024 * 1024, // 20MB
}

const ALLOWED_MIME: Record<'image' | 'video' | 'audio', Record<string, true>> = {
  image: {
    'image/png': true,
    'image/jpeg': true,
    'image/jpg': true,
    'image/webp': true,
    'image/gif': true,
  },
  video: {
    'video/mp4': true,
    'video/webm': true,
    'video/quicktime': true,
  },
  audio: {
    'audio/mpeg': true,
    'audio/mp3': true,
    'audio/wav': true,
    'audio/ogg': true,
    'audio/mp4': true,
    'audio/aac': true,
    'audio/webm': true,
  },
}

function kindOf(mime: string): 'image' | 'video' | 'audio' | null {
  if (ALLOWED_MIME.image[mime]) return 'image'
  if (ALLOWED_MIME.video[mime]) return 'video'
  if (ALLOWED_MIME.audio[mime]) return 'audio'
  return null
}

// ----- fieldType routing -----

type StoryboardFieldType = 'firstFrameUrl' | 'lastFrameUrl' | 'videoUrl' | 'ttsAudioUrl'
type AssetFieldType = 'imageUrl'

interface RouteTarget {
  kind: 'storyboard' | 'character' | 'scene'
  fieldType: StoryboardFieldType | AssetFieldType
  // The id field on the request (one of these must match `kind`).
  idField: 'storyboardId' | 'characterId' | 'sceneId'
}

/**
 * Resolve the upload target from form data. Returns null + reason if the
 * request shape is invalid (exactly one of storyboardId/characterId/sceneId
 * must be present, and fieldType must be compatible).
 */
function resolveTarget(
  storyboardId: string | null,
  characterId: string | null,
  sceneId: string | null,
  fieldType: string | null
): { target: RouteTarget } | { error: string } {
  if (!fieldType) {
    return { error: '缺少 fieldType 参数' }
  }

  const provided = [
    storyboardId && 'storyboard',
    characterId && 'character',
    sceneId && 'scene',
  ].filter(Boolean) as Array<'storyboard' | 'character' | 'scene'>

  if (provided.length !== 1) {
    return { error: '必须且只能提供 storyboardId / characterId / sceneId 之一' }
  }

  if (provided[0] === 'storyboard') {
    const valid: StoryboardFieldType[] = ['firstFrameUrl', 'lastFrameUrl', 'videoUrl', 'ttsAudioUrl']
    if (!valid.includes(fieldType as StoryboardFieldType)) {
      return {
        error: `Storyboard 不支持的 fieldType: ${fieldType}（允许: ${valid.join(', ')}）`,
      }
    }
    return {
      target: {
        kind: 'storyboard',
        fieldType: fieldType as StoryboardFieldType,
        idField: 'storyboardId',
      },
    }
  }

  if (provided[0] === 'character' || provided[0] === 'scene') {
    if (fieldType !== 'imageUrl') {
      return { error: `${provided[0]} 仅支持 fieldType=imageUrl` }
    }
    return {
      target: {
        kind: provided[0],
        fieldType: 'imageUrl',
        idField: provided[0] === 'character' ? 'characterId' : 'sceneId',
      },
    }
  }

  return { error: '未知的 target' }
}

// ----- Drama access check -----

async function userOwnsDrama(
  userId: string,
  role: string,
  dramaId: string
): Promise<boolean> {
  const drama = await db.drama.findUnique({
    where: { id: dramaId },
    select: { userId: true },
  })
  if (!drama) return false
  if (role === 'admin') return true
  return drama.userId === userId
}

// ----- POST /api/upload -----

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const storyboardId = (formData.get('storyboardId') as string | null) || null
    const characterId = (formData.get('characterId') as string | null) || null
    const sceneId = (formData.get('sceneId') as string | null) || null
    const fieldType = (formData.get('fieldType') as string | null) || null

    if (!file) {
      return NextResponse.json({ error: '缺少文件' }, { status: 400 })
    }

    // 1. Validate routing shape
    const routed = resolveTarget(storyboardId, characterId, sceneId, fieldType)
    if ('error' in routed) {
      return NextResponse.json({ error: routed.error }, { status: 400 })
    }
    const { target } = routed

    // 2. Validate MIME type
    const mime = file.type || 'application/octet-stream'
    const kind = kindOf(mime)
    if (!kind) {
      return NextResponse.json(
        { error: `不支持的文件类型: ${mime}` },
        { status: 400 }
      )
    }

    // 3. Validate size
    if (file.size > MAX_SIZE[kind]) {
      const mb = Math.round(MAX_SIZE[kind] / 1024 / 1024)
      return NextResponse.json(
        { error: `文件过大: ${kind} 最多 ${mb}MB` },
        { status: 413 }
      )
    }

    // 4. Resolve target entity + dramaId + access check
    const targetId = (formData.get(target.idField) as string) || ''
    if (!targetId) {
      return NextResponse.json({ error: `缺少 ${target.idField}` }, { status: 400 })
    }

    let dramaId: string
    if (target.kind === 'storyboard') {
      const sb = await db.storyboard.findUnique({
        where: { id: targetId },
        select: { episode: { select: { dramaId: true } } },
      })
      if (!sb) {
        return NextResponse.json({ error: 'Storyboard 不存在' }, { status: 404 })
      }
      dramaId = sb.episode.dramaId
    } else if (target.kind === 'character') {
      const ch = await db.character.findUnique({
        where: { id: targetId },
        select: { dramaId: true },
      })
      if (!ch) {
        return NextResponse.json({ error: 'Character 不存在' }, { status: 404 })
      }
      dramaId = ch.dramaId
    } else {
      const sc = await db.scene.findUnique({
        where: { id: targetId },
        select: { dramaId: true },
      })
      if (!sc) {
        return NextResponse.json({ error: 'Scene 不存在' }, { status: 404 })
      }
      dramaId = sc.dramaId
    }

    if (!(await userOwnsDrama(auth.userId, auth.role, dramaId))) {
      return NextResponse.json({ error: '无权访问此项目' }, { status: 403 })
    }

    // 5. Persist file to storage
    const buffer = Buffer.from(await file.arrayBuffer())

    // Choose storage path layout based on kind/target
    let category: string
    let subfolder: string | undefined
    if (target.kind === 'storyboard') {
      category = 'storyboards'
      subfolder = target.fieldType === 'videoUrl' ? 'videos' : undefined
    } else if (target.kind === 'character') {
      category = 'characters'
    } else {
      category = 'scenes'
    }

    // Strip the original extension — saveMediaFile appends one from the
    // MIME type, so we don't want a double suffix like "foo.png.png".
    const dotIdx = file.name.lastIndexOf('.')
    const baseName = dotIdx > 0 ? file.name.slice(0, dotIdx) : file.name
    const safeOriginal = baseName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60) || 'upload'

    const stored = await saveMediaFile(buffer, {
      mimeType: mime,
      category,
      subfolder,
      dramaId,
      filename: `${targetId}_${target.fieldType}_${Date.now()}_${safeOriginal}`,
    })

    // 6. Update the linked database record
    const response: Record<string, unknown> = {
      url: stored.url,
      size: stored.size,
      filename: stored.filename,
    }

    if (target.kind === 'storyboard') {
      const storyboard = await db.storyboard.update({
        where: { id: targetId },
        data: { [target.fieldType]: stored.url },
      })
      response.storyboard = storyboard
    } else if (target.kind === 'character') {
      const character = await db.character.update({
        where: { id: targetId },
        data: { imageUrl: stored.url },
      })
      response.character = character
    } else {
      const scene = await db.scene.update({
        where: { id: targetId },
        data: { imageUrl: stored.url },
      })
      response.scene = scene
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[upload] Failed:', error)
    return NextResponse.json(
      { error: '上传失败', detail: (error as Error).message },
      { status: 500 }
    )
  }
}
