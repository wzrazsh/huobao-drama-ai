import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { aiClient, VIEW_DEFS, type ViewLabel } from '@/lib/ai-config'
import { requireAuth } from '@/lib/auth-helpers'
import { saveMediaFile } from '@/lib/file-storage'

const ALL_VIEW_LABELS: ViewLabel[] = ['面部特写', '全身正面', '全身背面', '全身侧面']

const VIEW_INDEX: Record<ViewLabel, number> = {
  '面部特写': 0,
  '全身正面': 1,
  '全身背面': 2,
  '全身侧面': 3,
}

// Backward compatibility: map old labels to new VIEW_DEFS labels
const OLD_LABEL_MAP: Record<string, ViewLabel> = {
  '主形象': '面部特写',
  '角色设定图': '全身正面',
  '角色肖像': '全身背面',
}

function buildViewPrompt(
  character: { name: string; appearance?: string | null; personality?: string | null; role?: string | null },
  viewLabel: ViewLabel,
  style?: string
): string {
  const view = VIEW_DEFS[viewLabel]
  const styleTag = style || character.role || 'cinematic'
  return [
    `Character design, ${styleTag} style,`,
    character.name,
    character.appearance,
    character.personality ? `Personality: expressing ${character.personality}` : '',
    view.promptSuffix,
    'consistent character design, same person, same outfit, same hairstyle',
  ].filter(Boolean).join(', ')
}

async function upsertAppearance(
  characterId: string,
  viewLabel: ViewLabel,
  data: { imageUrl: string; imagePrompt: string; description: string }
) {
  const index = VIEW_INDEX[viewLabel]
  const existing = await db.characterAppearance.findFirst({
    where: { characterId, appearanceIndex: index },
  })
  if (existing) {
    return db.characterAppearance.update({
      where: { id: existing.id },
      data: {
        imageUrl: data.imageUrl,
        // Each view gets its own Appearance record, so imageUrls is always a single-element array
        imageUrls: JSON.stringify([data.imageUrl]),
        selectedIndex: 0,
        imagePrompt: data.imagePrompt,
        label: viewLabel,
        description: data.description || existing.description,
      },
    })
  }
  return db.characterAppearance.create({
    data: {
      characterId,
      appearanceIndex: index,
      label: viewLabel,
      description: data.description,
      imagePrompt: data.imagePrompt,
      imageUrl: data.imageUrl,
      imageUrls: JSON.stringify([data.imageUrl]),
      selectedIndex: 0,
    },
  })
}

// POST /api/ai/generate-character-image - AI Generate Character Portrait
// Supports single view (viewLabel) or batch mode (all 4 views)
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    aiClient._userId = auth.userId
    const { characterId, style, referenceImages, viewLabel } = await request.json() as {
      characterId: string
      style?: string
      referenceImages?: string[]
      viewLabel?: ViewLabel
    }

    if (!characterId) {
      return NextResponse.json(
        { error: 'characterId is required' },
        { status: 400 }
      )
    }

    // Get character
    const character = await db.character.findUnique({
      where: { id: characterId },
    })

    if (!character) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    }

    // Build description from character appearance
    const appearanceDesc =
      character.appearance || `${character.name}, ${character.gender}`

    const negativePrompt =
      'blurry, low quality, distorted face, extra limbs, deformed, watermark, text, signature, cartoon, anime'

    if (viewLabel) {
      // === Single view mode (with backward compat label mapping) ===

      // Map old labels for backward compatibility
      const mappedLabel = OLD_LABEL_MAP[viewLabel] || viewLabel
      if (!(mappedLabel in VIEW_DEFS)) {
        return NextResponse.json(
          { error: `Invalid viewLabel: ${viewLabel}` },
          { status: 400 }
        )
      }

      let base64Image: string
      let imagePrompt: string

      try {
        imagePrompt = buildViewPrompt(character, mappedLabel, style)
        base64Image = await aiClient.generateImage(imagePrompt, negativePrompt, {
          width: mappedLabel === '面部特写' ? 1024 : 768,
          height: 1024,
          referenceImages,
        })
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AsyncTaskError' && error.message.startsWith('ASYNC_TASK:')) {
          const taskId = error.message.replace('ASYNC_TASK:', '')
          return NextResponse.json({
            status: 'processing',
            taskId,
            category: 'image',
            characterId,
            message: '角色图像生成中，请稍后查询',
          })
        }
        throw error
      }

      const saveResult = await saveMediaFile(base64Image, {
        mimeType: 'image/png',
        category: 'characters',
        dramaId: character.dramaId,
        filename: `char_${characterId}_${mappedLabel}_${Date.now()}`,
      })
      const imageUrl = saveResult.url

      // Use AI Vision to extract a text description from the generated image
      let visionDescription = ''
      try {
        visionDescription = await aiClient.chat(
          '请描述这个角色形象的外貌特征，包括发型、发色、肤色、五官、服装、配饰等细节。用简洁的中文描述，不超过200字。',
          '你是一个专业的角色设计描述专家，擅长从图片中提取角色的外观特征描述。',
          { max_tokens: 500, temperature: 0.3 }
        )
      } catch (visionError) {
        console.error('AI Vision description extraction failed (non-fatal):', visionError)
      }

      // For 面部特写, also update Character.imageUrl (backward compat)
      if (mappedLabel === '面部特写') {
        await db.character.update({
          where: { id: characterId },
          data: { imageUrl, imagePrompt },
        })
      }

      const appearance = await upsertAppearance(characterId, mappedLabel, {
        imageUrl,
        imagePrompt,
        description: visionDescription || appearanceDesc,
      })

      return NextResponse.json({
        imageUrl,
        viewLabel: mappedLabel,
        appearance: {
          ...appearance,
          imageUrls: JSON.parse(appearance.imageUrls),
        },
        visionDescription,
      })
    } // end if (viewLabel)

    // === Batch mode: generate all 4 views ===
    const results: Array<{ label: ViewLabel; imageUrl: string }> = []
    let faceCloseUpUrl: string | null = null

    for (const label of ALL_VIEW_LABELS) {
      try {
        const refs: string[] = []
        // 面部特写 has no reference; other views use face close-up as reference
        if (label !== '面部特写' && faceCloseUpUrl) {
          refs.push(faceCloseUpUrl)
        }

        const imagePrompt = buildViewPrompt(character, label, style)
        const base64Image = await aiClient.generateImage(
          imagePrompt,
          negativePrompt,
          {
            width: label === '面部特写' ? 1024 : 768,
            height: 1024,
            referenceImages: refs.length > 0 ? refs : undefined,
          }
        )

        const saveResult = await saveMediaFile(base64Image, {
          mimeType: 'image/png',
          category: 'characters',
          dramaId: character.dramaId,
          filename: `char_${characterId}_${label}_${Date.now()}`,
        })
        const imageUrl = saveResult.url

        // Run vision description only on the first (face close-up) view
        let visionDescription = ''
        if (label === '面部特写') {
          try {
            visionDescription = await aiClient.chat(
              '请描述这个角色形象的外貌特征，包括发型、发色、肤色、五官、服装、配饰等细节。用简洁的中文描述，不超过200字。',
              '你是一个专业的角色设计描述专家，擅长从图片中提取角色的外观特征描述。',
              { max_tokens: 500, temperature: 0.3 }
            )
          } catch (visionError) {
            console.error('AI Vision description extraction failed (non-fatal):', visionError)
          }

          // Save face close-up URL for later views and update Character.imageUrl
          faceCloseUpUrl = imageUrl
          await db.character.update({
            where: { id: characterId },
            data: { imageUrl, imagePrompt },
          })
        }

        await upsertAppearance(characterId, label, {
          imageUrl,
          imagePrompt,
          description: visionDescription || appearanceDesc,
        })

        results.push({ label, imageUrl })
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AsyncTaskError' && err.message.startsWith('ASYNC_TASK:')) {
          console.log(`View "${label}" started async task: ${err.message}`)
          // For now, log and continue — individual taskId polling is out of scope
          // The view will be regenerated on next batch call
          continue
        }
        console.error(`Failed to generate view "${label}":`, err)
        // Continue with other views on failure
      }
    }

    return NextResponse.json({ views: results })
  } catch (error) {
    console.error('Failed to generate character image:', error)
    return NextResponse.json(
      { error: 'Failed to generate character image' },
      { status: 500 }
    )
  }
}
