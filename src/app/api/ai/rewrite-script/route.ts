import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { rewriteEpisodeScript } from '@/lib/platform/script-service'
import { toPlatformError } from '@/lib/platform/errors'

// POST /api/ai/rewrite-script - AI Script Rewrite
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const { episodeId } = await request.json()
    const episode = await rewriteEpisodeScript(auth, episodeId)
    return NextResponse.json({ episode, scriptContent: episode.scriptContent })
  } catch (error) {
    const platformError = toPlatformError(error)
    console.error('Failed to rewrite script:', platformError)
    return NextResponse.json(
      { error: platformError.message, code: platformError.code },
      { status: platformError.status }
    )
  }
}
