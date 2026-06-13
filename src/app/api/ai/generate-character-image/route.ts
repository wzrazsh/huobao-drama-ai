import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { aiClient, VIEW_DEFS, type ViewLabel } from '@/lib/ai-config'
import { requireAuth } from '@/lib/auth-helpers'
import { saveMediaFile } from '@/lib/file-storage'
import { buildCharacterIdentityPrompt } from '@/lib/character-prompts'

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
  character: {
    name: string
    imagePrompt?: string | null
    appearance?: string | null
    personality?: string | null
  },
  viewLabel: ViewLabel,
  style?: string
): string {
  const view = VIEW_DEFS[viewLabel]
  const identityPrompt = buildCharacterIdentityPrompt(character)
  const stylePrompt = style === '写实'
    ? 'photorealistic live-action character reference, natural skin texture, realistic human proportions'
    : style ? `${style} visual style` : 'cinematic photorealistic character reference'

  return [
    stylePrompt,
    `identity specification: ${identityPrompt}`,
    'single character only',
    view.promptSuffix,
    `strict framing requirement: ${viewLabel === '面部特写'
      ? 'head and shoulders portrait'
      : 'full-length turnaround reference photograph, the complete human figure from the top of the head to both shoes entirely inside the frame, generous plain background margin above the head and below the shoes, subject occupies about 70 percent of the frame height'}`,
    'preserve the exact identity, age, gender, facial features, hairstyle, outfit and color palette',
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

      let imageResult: { base64: string; sourceUrl?: string }
      let imagePrompt: string
      try {
        imagePrompt = buildViewPrompt(character, mappedLabel, style)
        imageResult = await aiClient.generateImageResult(imagePrompt, negativePrompt, {
          size: VIEW_DEFS[mappedLabel].aspectRatio === '1:1' ? '1024x1024' : '864x1152',
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

      const saveResult = await saveMediaFile(imageResult.base64, {
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

      // For 面部特写, also update Character.imageUrl (backward compat).
      // Character.imagePrompt is the asset-level character prompt and must be preserved.
      if (mappedLabel === '面部特写') {
        await db.character.update({
          where: { id: characterId },
          data: { imageUrl },
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
        sourceReferenceUrl: imageResult.sourceUrl,
      })
    } // end if (viewLabel)

    // === Batch mode: generate all 4 views ===
    const results: Array<{ label: ViewLabel; imageUrl: string; imagePrompt: string }> = []
    const failures: Array<{ label: ViewLabel; error: string }> = []
    let faceReferenceUrl: string | null = null
    let fullBodyReferenceUrl: string | null = null

    for (const label of ALL_VIEW_LABELS) {
      try {
        const imagePrompt = buildViewPrompt(character, label, style)
        const imageResult = await aiClient.generateImageResult(
          imagePrompt,
          negativePrompt,
          {
            size: VIEW_DEFS[label].aspectRatio === '1:1' ? '1024x1024' : '864x1152',
            referenceImages: label === '面部特写'
              ? referenceImages
              : label === '全身正面'
                ? faceReferenceUrl ? [faceReferenceUrl] : referenceImages
                : fullBodyReferenceUrl
                  ? [fullBodyReferenceUrl]
                  : faceReferenceUrl ? [faceReferenceUrl] : referenceImages,
          }
        )

        const saveResult = await saveMediaFile(imageResult.base64, {
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

          // Save face close-up URL for later views and update Character.imageUrl.
          // Preserve Character.imagePrompt as the asset-level character prompt.
          faceReferenceUrl = imageResult.sourceUrl || null
          await db.character.update({
            where: { id: characterId },
            data: { imageUrl },
          })
        } else if (label === '全身正面') {
          fullBodyReferenceUrl = imageResult.sourceUrl || null
        }

        await upsertAppearance(characterId, label, {
          imageUrl,
          imagePrompt,
          description: visionDescription || appearanceDesc,
        })

        results.push({ label, imageUrl, imagePrompt })
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AsyncTaskError' && err.message.startsWith('ASYNC_TASK:')) {
          failures.push({ label, error: '该供应商返回异步任务，批量角色生成暂不支持' })
        } else {
          failures.push({
            label,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        console.error(`Failed to generate view "${label}":`, err)
      }
    }

    return NextResponse.json(
      { views: results, failures },
      { status: results.length > 0 ? 200 : 502 }
    )
  } catch (error) {
    console.error('Failed to generate character image:', error)
    return NextResponse.json(
      { error: 'Failed to generate character image' },
      { status: 500 }
    )
  }
}
