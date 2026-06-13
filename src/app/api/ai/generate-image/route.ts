import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { generatePlatformImage } from '@/lib/platform/image-service'
import { toPlatformError } from '@/lib/platform/errors'

// POST /api/ai/generate-image - AI Generate Image (multi-provider)
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const result = await generatePlatformImage(auth, await request.json())
    return NextResponse.json(result)
  } catch (error) {
    const platformError = toPlatformError(error)
    console.error('Failed to generate image:', platformError)
    return NextResponse.json(
      { error: platformError.message, code: platformError.code },
      { status: platformError.status }
    )
  }
}
