import { aiClient, VIEW_DEFS, type ViewLabel } from '@/lib/ai-config'
import { db } from '@/lib/db'
import { saveMediaFile } from '@/lib/file-storage'
import { requireDramaAccess, type PlatformActor } from '@/lib/platform/access'
import { PlatformError } from '@/lib/platform/errors'
import { buildCharacterIdentityPrompt } from '@/lib/character-prompts'

export const CHARACTER_VIEW_LABELS = [
  '面部特写',
  '全身正面',
  '全身背面',
  '全身侧面',
] as const

export type CharacterViewLabel = (typeof CHARACTER_VIEW_LABELS)[number]

const VIEW_INDEX: Record<CharacterViewLabel, number> = {
  面部特写: 0,
  全身正面: 1,
  全身背面: 2,
  全身侧面: 3,
}

export interface RegenerateCharacterViewInput {
  characterId: string
  viewLabel: CharacterViewLabel
  style?: string
  promptOverride?: string
}

function aiClientForUser(userId: string) {
  return { ...aiClient, _userId: userId }
}

function buildViewPrompt(
  character: {
    name: string
    appearance: string
    personality: string
    role: string
    imagePrompt?: string | null
  },
  viewLabel: CharacterViewLabel,
  style?: string
) {
  const definition = VIEW_DEFS[viewLabel as ViewLabel]
  return [
    style ? `${style} visual style` : 'cinematic photorealistic character reference',
    `identity specification: ${buildCharacterIdentityPrompt(character)}`,
    'single character only',
    definition.promptSuffix,
    'preserve the exact identity, age, gender, facial features, hairstyle, outfit and color palette',
  ]
    .filter(Boolean)
    .join(', ')
}

export async function regenerateCharacterView(
  actor: PlatformActor,
  input: RegenerateCharacterViewInput
) {
  if (!input.characterId?.trim()) {
    throw new PlatformError('BAD_REQUEST', 'characterId is required', 400)
  }
  if (!CHARACTER_VIEW_LABELS.includes(input.viewLabel)) {
    throw new PlatformError('BAD_REQUEST', `Invalid viewLabel: ${input.viewLabel}`, 400)
  }

  const character = await db.character.findUnique({
    where: { id: input.characterId },
    select: {
      id: true,
      dramaId: true,
      name: true,
      gender: true,
      appearance: true,
      personality: true,
      role: true,
      imagePrompt: true,
    },
  })
  if (!character) {
    throw new PlatformError('NOT_FOUND', 'Character not found', 404)
  }
  await requireDramaAccess(actor, character.dramaId, 'write')

  const imagePrompt =
    input.promptOverride?.trim() ||
    buildViewPrompt(character, input.viewLabel, input.style)
  const negativePrompt = [
    VIEW_DEFS[input.viewLabel as ViewLabel].negativeSuffix,
    'multiple people, duplicate body, cropped feet, extra limbs, malformed hands',
    'blurry, low quality, watermark, text, signature',
  ].join(', ')

  let base64Image: string
  try {
    base64Image = await aiClientForUser(actor.userId).generateImage(
      imagePrompt,
      negativePrompt,
      {
        size: input.viewLabel === '面部特写' ? '1024x1024' : '864x1152',
      }
    )
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'AsyncTaskError' &&
      error.message.startsWith('ASYNC_TASK:')
    ) {
      const taskId = error.message.slice('ASYNC_TASK:'.length)
      return {
        status: 'processing' as const,
        taskId,
        category: 'image' as const,
        dramaId: character.dramaId,
        characterId: character.id,
        viewLabel: input.viewLabel,
        prompt: imagePrompt,
      }
    }
    throw error
  }

  const saved = await saveMediaFile(base64Image, {
    mimeType: 'image/png',
    category: 'characters',
    dramaId: character.dramaId,
    filename: `char_${character.id}_${input.viewLabel}_${Date.now()}`,
  })

  const index = VIEW_INDEX[input.viewLabel]
  const existing = await db.characterAppearance.findFirst({
    where: { characterId: character.id, appearanceIndex: index },
    select: { id: true, description: true },
  })
  const description =
    existing?.description ||
    character.appearance ||
    `${character.name}, ${character.gender}`

  const appearance = existing
    ? await db.characterAppearance.update({
        where: { id: existing.id },
        data: {
          label: input.viewLabel,
          imageUrl: saved.url,
          imageUrls: JSON.stringify([saved.url]),
          selectedIndex: 0,
          imagePrompt,
          description,
        },
      })
    : await db.characterAppearance.create({
        data: {
          characterId: character.id,
          appearanceIndex: index,
          label: input.viewLabel,
          imageUrl: saved.url,
          imageUrls: JSON.stringify([saved.url]),
          selectedIndex: 0,
          imagePrompt,
          description,
        },
      })

  if (input.viewLabel === '面部特写') {
    await db.character.update({
      where: { id: character.id },
      data: { imageUrl: saved.url },
    })
  }

  return {
    status: 'completed' as const,
    characterId: character.id,
    characterName: character.name,
    dramaId: character.dramaId,
    viewLabel: input.viewLabel,
    imageUrl: saved.url,
    prompt: imagePrompt,
    appearance: {
      id: appearance.id,
      appearanceIndex: appearance.appearanceIndex,
      label: appearance.label,
    },
  }
}
