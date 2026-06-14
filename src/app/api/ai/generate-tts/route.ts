import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { aiClient } from '@/lib/ai-config'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-helpers'
import { getActiveProviderForUser } from '@/lib/ai-config'
import { recordGenerationCost, calcTtsCredits } from '@/lib/cost-tracker'
import { saveDataUrl, isDataUrl } from '@/lib/file-storage'
import { concatAudioSegments, getVideoDuration, ensureStorageDirs, PATHS } from '@/lib/ffmpeg'
import { promises as fs } from 'fs'

// ── Types ────────────────────────────────────────────────────────

/**
 * One TTS segment of a multi-speaker storyboard.
 * Mirrors the JSON shape stored in Storyboard.ttsSegments.
 */
export interface DialogueSegment {
  speaker: string
  text: string
  voiceId: string
  voiceName?: string
  audioUrl?: string
  startMs?: number
  endMs?: number
  status: 'pending' | 'completed' | 'failed'
  error?: string
}

/**
 * Shape for a segment in the POST body when requesting multi-segment TTS.
 * voiceId is optional here; the route resolves it from the speaker otherwise.
 */
interface SegmentInput {
  speaker: string
  text: string
  voiceId?: string
  voiceName?: string
}

// POST /api/ai/generate-tts - Generate TTS audio for a storyboard shot (multi-provider)
// Now looks up the character's voiceId and voiceStyle from the database
// v0.7: Saves audio to file storage instead of base64 data URLs in DB
// v0.8: Supports multi-segment TTS for multi-speaker storyboards via Storyboard.ttsSegments
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  let providerName = ''
  let modelName = ''

  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    aiClient._userId = auth.userId
    const { storyboardId, text, voiceId, voiceStyle, segments } =
      (await request.json()) as {
        storyboardId: string
        text?: string
        voiceId?: string
        voiceStyle?: string
        segments?: SegmentInput[]
      }

    if (!storyboardId) {
      return NextResponse.json(
        { error: 'storyboardId is required' },
        { status: 400 }
      )
    }

    // Get storyboard from DB
    const storyboard = await db.storyboard.findUnique({
      where: { id: storyboardId },
    })

    if (!storyboard) {
      return NextResponse.json(
        { error: 'Storyboard not found' },
        { status: 404 }
      )
    }

    // Resolve provider/model info for cost tracking
    try {
      const provider = await getActiveProviderForUser('tts', auth.userId)
      if (provider) {
        providerName = provider.provider
        modelName = provider.model
      }
    } catch {
      // non-critical
    }

    // Resolve dramaId and episodeId for cost tracking
    let dramaId: string | undefined
    let episodeId: string | undefined
    try {
      const episode = await db.episode.findUnique({
        where: { id: storyboard.episodeId },
        select: { dramaId: true, id: true },
      })
      if (episode) {
        dramaId = episode.dramaId
        episodeId = episode.id
      }
    } catch {
      // non-critical
    }

    // Resolve voiceId and voiceStyle from the character if not explicitly provided
    let resolvedVoiceId = voiceId
    let resolvedVoiceStyle = voiceStyle

    if (!resolvedVoiceId && storyboard.dialogueChar) {
      // Look up the episode to get dramaId, then find the character
      try {
        const episode = await db.episode.findUnique({
          where: { id: storyboard.episodeId },
          select: { dramaId: true },
        })

        if (episode) {
          const character = await db.character.findFirst({
            where: {
              dramaId: episode.dramaId,
              name: { equals: storyboard.dialogueChar },
            },
          })

          if (character) {
            if (character.voiceId) {
              resolvedVoiceId = character.voiceId
            }
            if (character.voiceStyle) {
              resolvedVoiceStyle = character.voiceStyle
            }
            // Build voice instructions from character personality + voiceStyle
            if (!resolvedVoiceStyle && character.personality) {
              resolvedVoiceStyle = character.personality
            }
          }
        }
      } catch {
        // non-critical
      }
    }

    // Mark storyboard as processing
    await db.storyboard.update({
      where: { id: storyboardId },
      data: { status: 'processing' },
    })

    // ── Multi-segment path ────────────────────────────────────────
    if (Array.isArray(segments) && segments.length > 0) {
      return await handleMultiSegment({
        storyboardId,
        storyboard,
        segments,
        dramaId,
        episodeId,
        providerName,
        modelName,
        startTime,
        resolvedVoiceStyle,
        fallbackVoiceId: resolvedVoiceId,
      })
    }

    // ── Single-segment path (legacy) ──────────────────────────────
    // Use provided text, or fall back to storyboard dialogue
    const ttsText = text || storyboard.dialogue || ''

    if (!ttsText) {
      return NextResponse.json(
        { error: 'No text provided and storyboard has no dialogue' },
        { status: 400 }
      )
    }

    // Generate TTS — aiClient now returns the audio data URL
    const audioDataUrl = await aiClient.generateTts(
      storyboardId,
      ttsText,
      resolvedVoiceId,
      resolvedVoiceStyle || undefined
    )

    // Save audio to file storage instead of storing base64 in DB
    let audioUrl = audioDataUrl
    if (isDataUrl(audioDataUrl)) {
      const saveResult = await saveDataUrl(audioDataUrl, {
        category: 'audio',
        dramaId,
        filename: `tts_${storyboardId}_${Date.now()}`,
      })
      audioUrl = saveResult.url
    }

    // Update storyboard with file URL
    const updatedStoryboard = await db.storyboard.update({
      where: { id: storyboardId },
      data: { ttsAudioUrl: audioUrl, status: 'completed' },
    })

    // Record cost for TTS generation
    if (dramaId) {
      try {
        recordGenerationCost({
          dramaId,
          episodeId,
          category: 'tts',
          provider: providerName,
          model: modelName,
          credits: calcTtsCredits(),
          generationMs: Date.now() - startTime,
        })
      } catch {
        /* non-blocking */
      }
    }

    return NextResponse.json({ storyboard: updatedStoryboard })
  } catch (error) {
    console.error('Failed to generate TTS:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ── Multi-segment implementation ─────────────────────────────────

interface MultiSegmentParams {
  storyboardId: string
  storyboard: { episodeId: string; dialogueChar: string | null }
  segments: SegmentInput[]
  dramaId?: string
  episodeId?: string
  providerName: string
  modelName: string
  startTime: number
  resolvedVoiceStyle?: string
  fallbackVoiceId?: string
}

async function handleMultiSegment(params: MultiSegmentParams) {
  const {
    storyboardId,
    segments,
    dramaId,
    episodeId,
    providerName,
    modelName,
    startTime,
    resolvedVoiceStyle,
    fallbackVoiceId,
  } = params

  // Ensure storage dirs exist (PATHS.audio, etc.)
  await ensureStorageDirs()
  await fs.mkdir(PATHS.audio, { recursive: true })

  // For each segment, build a per-segment record. Mark pending initially.
  const records: DialogueSegment[] = segments.map((s) => ({
    speaker: s.speaker,
    text: s.text,
    voiceId: s.voiceId || fallbackVoiceId || '',
    voiceName: s.voiceName,
    status: 'pending' as const,
  }))

  // Resolve any missing voiceIds by looking up the character in DB
  for (let i = 0; i < records.length; i++) {
    if (!records[i].voiceId) {
      try {
        const episode = await db.episode.findUnique({
          where: { id: params.storyboard.episodeId },
          select: { dramaId: true },
        })
        if (episode) {
          const character = await db.character.findFirst({
            where: {
              dramaId: episode.dramaId,
              name: { equals: records[i].speaker },
            },
          })
          if (character?.voiceId) {
            records[i].voiceId = character.voiceId
          }
        }
      } catch {
        // non-critical, will fail in the per-segment call below
      }
    }
  }

  // Generate TTS per segment, collecting successful audio paths.
  const successfulPaths: string[] = []
  let allFailed = true
  let anySucceeded = false

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    if (!rec.voiceId) {
      rec.status = 'failed'
      rec.error = 'voiceId could not be resolved'
      continue
    }
    try {
      const dataUrl = await aiClient.generateTts(
        storyboardId,
        rec.text,
        rec.voiceId,
        resolvedVoiceStyle || undefined
      )

      // Save the per-segment audio to local temp file (we need a local path for ffmpeg)
      const tempPath = path.join(PATHS.audio, `seg_${storyboardId}_${i}_${Date.now()}.mp3`)
      if (isDataUrl(dataUrl)) {
        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
        if (!match) {
          throw new Error('Invalid data URL from TTS provider')
        }
        const buffer = Buffer.from(match[2], 'base64')
        await fs.writeFile(tempPath, buffer)
      } else {
        // If it's already a URL, download it via the same path helper
        const resp = await fetch(dataUrl)
        if (!resp.ok) {
          throw new Error(`TTS audio URL returned ${resp.status}`)
        }
        const arr = await resp.arrayBuffer()
        await fs.writeFile(tempPath, Buffer.from(arr))
      }

      // Persist per-segment audio via file storage so the UI can play it.
      let audioUrl: string | undefined
      if (isDataUrl(dataUrl)) {
        const saveResult = await saveDataUrl(dataUrl, {
          category: 'audio',
          dramaId,
          filename: `tts_${storyboardId}_seg${i}_${Date.now()}`,
        })
        audioUrl = saveResult.url
      } else {
        audioUrl = dataUrl
      }

      rec.audioUrl = audioUrl
      rec.status = 'completed'
      delete rec.error
      successfulPaths.push(tempPath)
      anySucceeded = true
    } catch (err) {
      rec.status = 'failed'
      rec.error = err instanceof Error ? err.message : 'Unknown error'
      console.error(`TTS segment ${i} failed:`, rec.error)
    }
  }

  allFailed = !anySucceeded

  if (allFailed) {
    // Reset status so the user can retry
    await db.storyboard.update({
      where: { id: storyboardId },
      data: { status: 'failed' },
    })
    return NextResponse.json(
      { error: 'All TTS segments failed', segments: records },
      { status: 500 }
    )
  }

  // Compute startMs/endMs from cumulative durations of successful segments
  const durations: number[] = []
  for (const p of successfulPaths) {
    const dur = await getVideoDuration(p) // ffprobe works on audio-only files too
    durations.push(dur)
  }

  let cumulativeMs = 0
  let segIdx = 0
  for (let i = 0; i < records.length; i++) {
    if (records[i].status !== 'completed') {
      // No timing for failed segments
      continue
    }
    const durMs = Math.round(durations[segIdx] * 1000)
    records[i].startMs = cumulativeMs
    records[i].endMs = cumulativeMs + durMs
    cumulativeMs += durMs
    segIdx++
  }

  // Concat the successful segments into one merged mp3
  const mergedPath = await concatAudioSegments(successfulPaths)

  // Save merged file to file storage
  const mergedBuffer = await fs.readFile(mergedPath)
  const mergedDataUrl = `data:audio/mpeg;base64,${mergedBuffer.toString('base64')}`
  const mergedSave = await saveDataUrl(mergedDataUrl, {
    category: 'audio',
    dramaId,
    filename: `tts_${storyboardId}_merged_${Date.now()}`,
  })

  // Clean up temp per-segment files (best-effort)
  for (const p of successfulPaths) {
    try {
      await fs.unlink(p)
    } catch {
      // ignore
    }
  }
  try {
    await fs.unlink(mergedPath)
  } catch {
    // ignore
  }

  // Determine overall status
  const failedCount = records.filter((r) => r.status === 'failed').length
  const finalStatus = failedCount === 0 ? 'completed' : 'partial'

  // Persist
  const updatedStoryboard = await db.storyboard.update({
    where: { id: storyboardId },
    data: {
      ttsAudioUrl: mergedSave.url,
      ttsSegments: JSON.stringify(records),
      status: finalStatus === 'partial' ? 'partial' : 'completed',
    },
  })

  // Record cost once for the whole multi-segment generation
  if (dramaId) {
    try {
      recordGenerationCost({
        dramaId,
        episodeId,
        category: 'tts',
        provider: providerName,
        model: modelName,
        credits: calcTtsCredits() * records.filter((r) => r.status === 'completed').length,
        generationMs: Date.now() - startTime,
      })
    } catch {
      /* non-blocking */
    }
  }

  if (failedCount > 0) {
    return NextResponse.json(
      {
        storyboard: updatedStoryboard,
        partial: true,
        failedSegments: records
          .map((r, i) => (r.status === 'failed' ? i : -1))
          .filter((i) => i >= 0),
        segments: records,
      },
      { status: 207 }
    )
  }

  return NextResponse.json({ storyboard: updatedStoryboard, segments: records })
}
