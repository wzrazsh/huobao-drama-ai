import { NextRequest, NextResponse } from 'next/server'
import { getActiveProvider } from '@/lib/ai-config'
import { requireAuth } from '@/lib/auth-helpers'
import { pollPlatformImage } from '@/lib/platform/image-service'
import { toPlatformError } from '@/lib/platform/errors'

// POST /api/ai/poll-status - Check an async AI generation task.
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const { category, taskId, dramaId } = await request.json()
    if (!category || !taskId) {
      return NextResponse.json(
        { error: 'Missing category or taskId', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    if (category === 'image') {
      return NextResponse.json(
        await pollPlatformImage(auth, { taskId, dramaId })
      )
    }

    if (category === 'video') {
      const provider = await getActiveProvider('video')
      if (!provider) {
        return NextResponse.json({ error: 'No active provider' }, { status: 400 })
      }

      const { getVideoAdapter } = await import('@/lib/adapters/video')
      const adapter = getVideoAdapter(provider.provider)
      const config = {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
      }
      const pollRequest = adapter.buildPollRequest(config, taskId)
      if (!pollRequest) {
        return NextResponse.json(
          { status: 'unsupported', error: 'The active provider does not support polling' },
          { status: 400 }
        )
      }

      const response = await fetch(pollRequest.url, {
        method: pollRequest.method,
        headers: pollRequest.headers,
      })
      const parsed = adapter.parsePollResponse(await response.json())
      if (parsed.status === 'completed') {
        return NextResponse.json({ status: 'completed', videoUrl: parsed.videoUrl })
      }
      return NextResponse.json({ status: parsed.status, error: parsed.error })
    }

    return NextResponse.json({ error: 'Unsupported category' }, { status: 400 })
  } catch (error) {
    const platformError = toPlatformError(error)
    return NextResponse.json(
      { error: platformError.message, code: platformError.code },
      { status: platformError.status }
    )
  }
}
