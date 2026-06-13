interface CharacterPromptSource {
  name: string
  gender?: string | null
  age?: string | null
  appearance?: string | null
  personality?: string | null
  imagePrompt?: string | null
}

export function sanitizeCharacterIdentityPrompt(prompt: string): string {
  return prompt
    .replace(/\bCharacter design,\s*[^,]*style,*/gi, '')
    .replace(/\bPersonality:\s*expressing\b/gi, 'personality expressed visually as')
    .replace(/\b(close-up portrait|face centered|looking at camera|shoulders visible|facial features detailed|cinematic lighting|shallow depth of field)\b/gi, '')
    .replace(/\b(full body (front|back|side) view|front view|back view|side view|profile view)\b/gi, '')
    .replace(/\b(consistent character design|same person|same face|same outfit|same hairstyle)\b/gi, '')
    .replace(/(?:\s*,\s*){2,}/g, ', ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .slice(0, 1100)
}

export function buildCharacterIdentityPrompt(character: CharacterPromptSource): string {
  const existing = character.imagePrompt?.trim()
  if (existing) {
    return sanitizeCharacterIdentityPrompt(existing)
  }

  return [
    `character identity reference: ${character.name}`,
    character.gender && character.gender !== 'unknown' ? `gender: ${character.gender}` : '',
    character.age ? `age: ${character.age}` : '',
    character.appearance,
    character.personality
      ? `personality expressed visually as ${character.personality}`
      : '',
  ]
    .filter(Boolean)
    .join(', ')
    .slice(0, 1100)
}
