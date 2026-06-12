import type {
  ProviderRequest,
  VideoProviderAdapter,
} from './types'

import { joinProviderUrl } from './url'

// ============================================================================
// MiniMax Video Adapter
// ============================================================================

export class MiniMaxVideoAdapter implements VideoProviderAdapter {
  buildGenerateRequest(
    config: { baseUrl: string; apiKey: string; model: string },
    params: { prompt: string; firstFrameUrl?: string; lastFrameUrl?: string; duration?: number }
  ): ProviderRequest {
    const model = config.model || 'MiniMax-Hailuo-2.3'
    const duration = params.duration || 6

    // Build the prompt string, appending first frame reference if provided
    let prompt = params.prompt

    if (params.firstFrameUrl) {
      prompt = `${prompt}\n[参考图: ${params.firstFrameUrl}]`
    }

    const body: Record<string, unknown> = {
      model,
      prompt,
      duration,
      resolution: '768P',
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/video_generation'),
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body,
    }
  }

  parseGenerateResponse(result: unknown): {
    isAsync: boolean
    taskId?: string
    videoUrl?: string
  } {
    const resp = result as Record<string, unknown>
    const taskId = (resp.task_id as string) || (resp.id as string)

    if (!taskId) {
      return { isAsync: true }
    }

    return { isAsync: true, taskId }
  }

  buildPollRequest(
    config: { baseUrl: string; apiKey: string; model: string },
    taskId: string
  ): ProviderRequest | null {
    return {
      url: `${joinProviderUrl(config.baseUrl, '/v1', '/query/video_generation')}?task_id=${taskId}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: null,
    }
  }

  parsePollResponse(result: unknown): {
    status: 'pending' | 'processing' | 'completed' | 'failed'
    videoUrl?: string
    error?: string
  } {
    const resp = result as Record<string, unknown>
    const status = resp.status as string

    if (status === 'Success' || status === 'success' || status === 'Succeeded' || status === 'succeeded') {
      const fileId = resp.file_id as string | undefined
      if (!fileId) {
        return { status: 'failed', error: 'MiniMax: Task completed but no file_id returned' }
      }
      const videoUrl = `https://api.minimaxi.com/v1/files/retrieve?file_id=${fileId}`
      return { status: 'completed', videoUrl }
    }

    if (status === 'Fail' || status === 'fail' || status === 'Failed' || status === 'failed') {
      return { status: 'failed', error: `MiniMax: Task failed - ${JSON.stringify(resp.error || resp)}` }
    }

    if (status === 'Preparing' || status === 'Queueing') {
      return { status: 'pending' }
    }

    return { status: 'processing' }
  }
}

// ============================================================================
// VolcEngine Video Adapter (火山引擎/Seedance)
// ============================================================================

export class VolcEngineVideoAdapter implements VideoProviderAdapter {
  buildGenerateRequest(
    config: { baseUrl: string; apiKey: string; model: string },
    params: { prompt: string; firstFrameUrl?: string; lastFrameUrl?: string; duration?: number }
  ): ProviderRequest {
    const model = config.model || 'doubao-seedance-1-5-pro-251215'
    const duration = Math.max(4, Math.min(12, params.duration || 5))

    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: params.prompt },
    ]

    if (params.firstFrameUrl) {
      content.push({
        type: 'image_url',
        image_url: { url: params.firstFrameUrl },
      })
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/api/v3', '/contents/generations/tasks'),
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: {
        model,
        content,
        generate_audio: false,
        ratio: '16:9',
        duration,
        watermark: false,
      },
    }
  }

  parseGenerateResponse(result: unknown): {
    isAsync: boolean
    taskId?: string
    videoUrl?: string
  } {
    const resp = result as Record<string, unknown>
    const taskId = resp.id as string | undefined

    if (!taskId) {
      return { isAsync: true }
    }

    return { isAsync: true, taskId }
  }

  buildPollRequest(
    config: { baseUrl: string; apiKey: string; model: string },
    taskId: string
  ): ProviderRequest | null {
    return {
      url: joinProviderUrl(config.baseUrl, '/api/v3', `/contents/generations/tasks/${taskId}`),
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: null,
    }
  }

  parsePollResponse(result: unknown): {
    status: 'pending' | 'processing' | 'completed' | 'failed'
    videoUrl?: string
    error?: string
  } {
    const resp = result as Record<string, unknown>
    const status = resp.status as string

    if (status === 'succeeded') {
      // video_url can be at top level or nested in content
      const videoUrl =
        (resp.video_url as string | undefined) ||
        ((resp.content as Record<string, unknown>)?.video_url as string | undefined)

      if (!videoUrl) {
        return {
          status: 'failed',
          error: 'VolcEngine: Task succeeded but no video_url returned',
        }
      }

      return { status: 'completed', videoUrl }
    }

    if (status === 'failed') {
      return {
        status: 'failed',
        error: `VolcEngine: Task failed - ${JSON.stringify(resp.error || resp)}`,
      }
    }

    if (status === 'running' || status === 'processing') {
      return { status: 'processing' }
    }

    return { status: 'pending' }
  }
}

// ============================================================================
// Vidu Video Adapter (Polling via GET /ent/v2/img2video/{task_id})
// ============================================================================

export class ViduVideoAdapter implements VideoProviderAdapter {
  buildGenerateRequest(
    config: { baseUrl: string; apiKey: string; model: string },
    params: { prompt: string; firstFrameUrl?: string; lastFrameUrl?: string; duration?: number }
  ): ProviderRequest {
    const model = config.model || 'viduq3-turbo'
    const duration = params.duration || 4

    const images: string[] = []
    if (params.firstFrameUrl) {
      images.push(params.firstFrameUrl)
    }
    if (params.lastFrameUrl) {
      images.push(params.lastFrameUrl)
    }

    const body: Record<string, unknown> = {
      model,
      images,
      prompt: params.prompt,
      resolution: '720p',
    }

    if (duration) {
      body.duration = duration
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/ent/v2', '/img2video'),
      method: 'POST',
      // Vidu uses "Token" prefix, NOT "Bearer"
      headers: { Authorization: `Token ${config.apiKey}`, 'Content-Type': 'application/json' },
      body,
    }
  }

  parseGenerateResponse(result: unknown): {
    isAsync: boolean
    taskId?: string
    videoUrl?: string
  } {
    const resp = result as Record<string, unknown>
    const taskId = resp.task_id as string | undefined

    if (!taskId) {
      return { isAsync: true }
    }

    return { isAsync: true, taskId }
  }

  buildPollRequest(
    config: { baseUrl: string; apiKey: string; model: string },
    taskId: string
  ): ProviderRequest | null {
    return {
      url: joinProviderUrl(config.baseUrl, '/ent/v2', `/img2video/${taskId}`),
      method: 'GET',
      headers: { Authorization: `Token ${config.apiKey}` },
      body: null,
    }
  }

  parsePollResponse(result: unknown): {
    status: 'pending' | 'processing' | 'completed' | 'failed'
    videoUrl?: string
    error?: string
  } {
    const resp = result as Record<string, unknown>
    const state = resp.state as string

    if (state === 'success' || state === 'completed') {
      const videoUrl = (resp.video_url || (resp as Record<string, unknown>).url) as string | undefined
      if (!videoUrl) {
        return { status: 'failed', error: 'Vidu: Task completed but no video_url returned' }
      }
      return { status: 'completed', videoUrl }
    }

    if (state === 'failed' || state === 'error') {
      return {
        status: 'failed',
        error: `Vidu: Task failed - ${JSON.stringify(resp.error || resp)}`,
      }
    }

    // processing, running, etc.
    return { status: 'processing' }
  }
}

// ============================================================================
// Ali Video Adapter (阿里/万相视频)
// ============================================================================

export class AliVideoAdapter implements VideoProviderAdapter {
  /** Resolve ratio to Ali resolution string */
  private resolveResolution(ratio?: string): string {
    if (ratio === '16:9') return '1080P'
    return '720P' // covers 9:16, 1:1, and default
  }

  buildGenerateRequest(
    config: { baseUrl: string; apiKey: string; model: string },
    params: { prompt: string; firstFrameUrl?: string; lastFrameUrl?: string; duration?: number }
  ): ProviderRequest {
    const model = config.model || 'wan2.6-i2v-flash'
    const baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com'
    const duration = params.duration || 5
    const resolution = this.resolveResolution('16:9')

    const input: Record<string, unknown> = {
      prompt: params.prompt,
    }

    if (params.firstFrameUrl) {
      input.img_url = params.firstFrameUrl
    }

    if (params.lastFrameUrl) {
      input.last_img_url = params.lastFrameUrl
    }

    return {
      url: joinProviderUrl(baseUrl, '/api/v1', '/services/aigc/video-generation/video-synthesis'),
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: {
        model,
        input,
        parameters: {
          resolution,
          duration,
          watermark: false,
        },
      },
    }
  }

  parseGenerateResponse(result: unknown): {
    isAsync: boolean
    taskId?: string
    videoUrl?: string
  } {
    const resp = result as Record<string, unknown>
    const output = resp.output as Record<string, unknown> | undefined
    const taskId = output?.task_id as string | undefined

    if (!taskId) {
      return { isAsync: true }
    }

    return { isAsync: true, taskId }
  }

  buildPollRequest(
    config: { baseUrl: string; apiKey: string; model: string },
    taskId: string
  ): ProviderRequest | null {
    const baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com'

    return {
      url: joinProviderUrl(baseUrl, '/api/v1', `/tasks/${taskId}`),
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: null,
    }
  }

  parsePollResponse(result: unknown): {
    status: 'pending' | 'processing' | 'completed' | 'failed'
    videoUrl?: string
    error?: string
  } {
    const resp = result as Record<string, unknown>
    const output = resp.output as Record<string, unknown> | undefined

    if (!output) {
      return { status: 'pending' }
    }

    const taskStatus = output.task_status as string

    if (taskStatus === 'SUCCEEDED') {
      const videoUrl = output.video_url as string | undefined
      if (!videoUrl) {
        return { status: 'failed', error: 'Ali: Task succeeded but no video_url returned' }
      }
      return { status: 'completed', videoUrl }
    }

    if (taskStatus === 'FAILED') {
      return {
        status: 'failed',
        error: `Ali: Task failed - ${JSON.stringify(output.message || output)}`,
      }
    }

    // RUNNING
    if (taskStatus === 'RUNNING') {
      return { status: 'processing' }
    }

    // PENDING, SUBMITTED, etc.
    return { status: 'pending' }
  }
}

// ============================================================================
// Adapter Registry
// ============================================================================

export const videoAdapters: Record<string, VideoProviderAdapter> = {
  minimax: new MiniMaxVideoAdapter(),
  volcengine: new VolcEngineVideoAdapter(),
  vidu: new ViduVideoAdapter(),
  ali: new AliVideoAdapter(),
}

export function getVideoAdapter(provider: string): VideoProviderAdapter {
  return videoAdapters[provider] || videoAdapters['minimax']
}
