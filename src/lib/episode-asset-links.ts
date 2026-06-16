export function parseEpisodeIds(value: string | null | undefined): string[] {
  if (!value) return []

  try {
    const ids = JSON.parse(value)
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function withEpisodeId(value: string | null | undefined, episodeId: string): string {
  const ids = parseEpisodeIds(value)
  if (!ids.includes(episodeId)) ids.push(episodeId)
  return JSON.stringify(ids)
}
