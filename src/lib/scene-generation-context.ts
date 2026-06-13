import { db } from '@/lib/db'

function parseIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function includesName(text: string, name: string): boolean {
  return Boolean(name.trim() && text.toLowerCase().includes(name.trim().toLowerCase()))
}

export interface SceneGenerationContext {
  characterDescriptions: string[]
  propDescriptions: string[]
  characterReferenceImages: string[]
  propReferenceImages: string[]
  characterNames: string[]
  propNames: string[]
}

export async function collectSceneGenerationContext(
  scene: {
    dramaId: string
    location: string
    description: string
    prompt: string
    episodeIds: string
  }
): Promise<SceneGenerationContext> {
  const [characters, props] = await Promise.all([
    db.character.findMany({
      where: { dramaId: scene.dramaId },
      include: {
        appearances: {
          where: { appearanceIndex: 0 },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.prop.findMany({
      where: { dramaId: scene.dramaId },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const characterSceneText = [scene.description, scene.prompt].join('\n')
  const fullSceneText = [scene.location, scene.description, scene.prompt].join('\n')
  const sceneEpisodeIds = new Set(parseIds(scene.episodeIds))
  const namedCharacters = characters.filter((character) =>
    includesName(characterSceneText, character.name)
  )
  const episodeCharacters = characters.filter((character) =>
    parseIds(character.episodeIds).some((episodeId) => sceneEpisodeIds.has(episodeId))
  )
  const hasUnnamedPeople = /两人|二人|人物|角色|男人|女人|女孩|男孩|青年|老人|(?:^|[，。；、\s])他(?:[，。；、\s]|$)|(?:^|[，。；、\s])她(?:[，。；、\s]|$)|\b(person|people|couple|man|woman|boy|girl|they)\b/i
    .test(characterSceneText)
  const relevantCharacters = (
    namedCharacters.length > 0
      ? namedCharacters
      : hasUnnamedPeople ? episodeCharacters : []
  )
    .slice(0, 3)
  const relevantProps = props
    .filter((prop) => includesName(fullSceneText, prop.name))
    .slice(0, 3)

  return {
    characterDescriptions: relevantCharacters.map((character) => {
      const identity = character.imagePrompt?.trim() || character.appearance
      return `${character.name}: ${identity}`
    }),
    propDescriptions: relevantProps.map((prop) => {
      const identity = prop.imagePrompt?.trim() || prop.description
      return `${prop.name}: ${identity}`
    }),
    characterReferenceImages: relevantCharacters
      .map((character) => {
        const appearance = character.appearances[0]
        return character.styleLock && character.lockedReferenceImage
          ? character.lockedReferenceImage
          : appearance?.imageUrl || character.imageUrl
      })
      .filter((url): url is string => Boolean(url?.trim())),
    propReferenceImages: relevantProps
      .map((prop) => prop.imageUrl)
      .filter((url): url is string => Boolean(url?.trim())),
    characterNames: relevantCharacters.map((character) => character.name),
    propNames: relevantProps.map((prop) => prop.name),
  }
}

export function buildSceneContentPrompt(
  basePrompt: string,
  context: SceneGenerationContext
): string {
  const cleanedBasePrompt = context.characterDescriptions.length > 0
    ? basePrompt
        .replace(/\b(no characters|no people|no figures|without people|empty scene)\b/gi, '')
        .replace(/(纯背景|不含人物|不要人物|无人物|无人场景)/g, '')
        .replace(/(?:\s*,\s*){2,}/g, ', ')
        .trim()
    : basePrompt
  const parts = [cleanedBasePrompt.slice(0, 650)]

  if (context.characterDescriptions.length > 0) {
    const characterSummaries = context.characterDescriptions
      .map((description) => description.slice(0, 180))
    parts.push(
      `Characters visibly present in this scene: ${characterSummaries.join('; ')}`,
      'Keep each named character recognizable and consistent with the supplied character reference image'
    )
  }

  if (context.propDescriptions.length > 0) {
    const propSummaries = context.propDescriptions
      .map((description) => description.slice(0, 160))
    parts.push(
      `Important visible props in this scene: ${propSummaries.join('; ')}`,
      'Render each named prop with its described shape, material, color and story details'
    )
  }

  return parts.join(', ').slice(0, 1450)
}

export function isPublicReferenceUrl(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url, origin)
    return !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
  } catch {
    return false
  }
}
