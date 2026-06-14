'use client'

import { motion } from 'framer-motion'
import {
  Loader2,
  Mic,
  Music,
  Upload,
  Sparkles,
  Volume2,
  UserCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { panelVariants } from './helpers'
import type { DubbingPanelProps, DialogueSegment } from './types'
import type { Storyboard } from '@/lib/store'

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Parse the ttsSegments JSON field on a Storyboard.
 * Returns null when the field is empty or malformed.
 */
function parseTtsSegments(sb: Storyboard): DialogueSegment[] | null {
  if (!sb.ttsSegments) return null
  try {
    const parsed = JSON.parse(sb.ttsSegments)
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as DialogueSegment[]
    }
    return null
  } catch {
    return null
  }
}

export function DubbingPanel({
  storyboards,
  characters,
  aiLoading,
  generatingTts,
  generatingAllTts,
  batchProgress,
  uploadingField,
  handleGenerateTts,
  handleGenerateAllTts,
  handleUpload,
}: DubbingPanelProps) {
  const storyboardsWithDialogue = storyboards.filter((sb) => sb.dialogue)
  const storyboardsWithTts = storyboardsWithDialogue.filter((sb) => sb.ttsAudioUrl)
  const pendingTts = storyboardsWithDialogue.filter((sb) => !sb.ttsAudioUrl)
  const progressPercent = storyboardsWithDialogue.length > 0
    ? Math.round((storyboardsWithTts.length / storyboardsWithDialogue.length) * 100)
    : 0

  // Helper: find character voice info
  const getCharVoice = (charName: string | null) => {
    if (!charName) return null
    return characters.find((c) => c.name === charName)
  }

  // Empty state
  if (storyboards.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md"
        >
          <div className="mx-auto size-16 rounded-full bg-primary/10 flex items-center justify-center mb-5">
            <Mic className="size-8 text-primary" />
          </div>
          <h2 className="text-lg font-semibold mb-2">配音生成</h2>
          <p className="text-sm text-muted-foreground">
            请先在剧本阶段生成分镜，然后在此为含对白的镜头生成配音
          </p>
        </motion.div>
      </div>
    )
  }

  if (storyboardsWithDialogue.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md"
        >
          <div className="mx-auto size-16 rounded-full bg-muted flex items-center justify-center mb-5">
            <Mic className="size-8 text-muted-foreground/50" />
          </div>
          <h2 className="text-lg font-semibold mb-2">暂无需配音的镜头</h2>
          <p className="text-sm text-muted-foreground">
            当分镜中包含对白时，将在此显示并可生成配音
          </p>
        </motion.div>
      </div>
    )
  }

  return (
    <motion.div
      variants={panelVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex flex-col h-full"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border/50 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-primary/80">08</span>
          <div>
            <h2 className="text-sm font-semibold">配音生成</h2>
            <p className="text-[10px] text-muted-foreground">
              为对白镜头生成或上传配音 · {storyboardsWithTts.length}/{storyboardsWithDialogue.length} 已完成
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {batchProgress && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              <span>{batchProgress.message}</span>
              <Progress value={(batchProgress.current / batchProgress.total) * 100} className="h-1.5 w-20" />
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleGenerateAllTts}
            disabled={generatingAllTts || !!generatingTts || aiLoading || pendingTts.length === 0}
          >
            {generatingAllTts || generatingTts ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            批量生成全部配音
            {pendingTts.length > 0 && (
              <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-1">{pendingTts.length}</Badge>
            )}
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-4">
          {/* Progress bar */}
          <div className="flex items-center gap-3">
            <Progress value={progressPercent} className="h-2 flex-1" />
            <span className="text-xs text-muted-foreground whitespace-nowrap">{progressPercent}%</span>
          </div>

          {/* Storyboard list with dialogue */}
          <div className="space-y-3">
            {storyboardsWithDialogue.map((sb) => {
              const isGenerating = generatingTts === sb.id
              const isUploading = uploadingField === `tts-${sb.id}`
              const hasTts = !!sb.ttsAudioUrl
              const charInfo = getCharVoice(sb.dialogueChar)
              const segs = parseTtsSegments(sb)
              const isMulti = segs !== null
              const completedSegs = segs ? segs.filter((s) => s.status === 'completed').length : 0
              const totalSegs = segs ? segs.length : 0

              return (
                <Card key={sb.id} className={`border-border/50 py-0 gap-0 ${hasTts ? 'ring-1 ring-emerald-500/20' : ''}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {/* Shot number */}
                      <div className="flex-shrink-0 w-12 text-center">
                        <span className="text-sm font-bold text-primary">
                          #{String(sb.shotNumber).padStart(2, '0')}
                        </span>
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        {/* Dialogue character + voice badge */}
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          {sb.dialogueChar && (
                            <>
                              <div className="flex items-center gap-1">
                                <UserCircle className="size-3.5 text-primary/70" />
                                <span className="text-xs font-semibold">{sb.dialogueChar}</span>
                              </div>
                              {charInfo?.voiceId ? (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-emerald-600 border-emerald-200">
                                  <Volume2 className="size-2.5 mr-0.5" />
                                  {charInfo.voiceId}
                                </Badge>
                              ) : charInfo?.voiceStyle ? (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  <Mic className="size-2.5 mr-0.5" />
                                  {charInfo.voiceStyle}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-600 border-amber-200">
                                  未分配音色
                                </Badge>
                              )}
                            </>
                          )}
                          {isMulti && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              分 {totalSegs} 段
                              {completedSegs > 0 && (
                                <span className="ml-1 text-emerald-600">{completedSegs}/{totalSegs}</span>
                              )}
                            </Badge>
                          )}
                          {hasTts && !isMulti && (
                            <Badge className="status-completed text-[9px] px-1.5 py-0">已配音</Badge>
                          )}
                        </div>

                        {/* Multi-segment sub-rows */}
                        {isMulti ? (
                          <div className="space-y-1.5 mb-2">
                            {segs!.map((seg, i) => (
                              <div
                                key={i}
                                className="border border-border/40 rounded-md p-2 bg-muted/20"
                              >
                                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                  <span className="text-xs font-medium">{seg.speaker}</span>
                                  {seg.voiceId && (
                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-emerald-600 border-emerald-200">
                                      <Volume2 className="size-2.5 mr-0.5" />
                                      {seg.voiceId}
                                    </Badge>
                                  )}
                                  <span
                                    className={`text-[9px] px-1.5 py-0 rounded ${
                                      seg.status === 'completed'
                                        ? 'bg-emerald-500/15 text-emerald-700'
                                        : seg.status === 'failed'
                                        ? 'bg-rose-500/15 text-rose-700'
                                        : 'bg-muted text-muted-foreground'
                                    }`}
                                  >
                                    {seg.status === 'completed' ? '已完成' : seg.status === 'failed' ? '失败' : '待生成'}
                                  </span>
                                </div>
                                <div className="text-xs text-muted-foreground mb-1.5">
                                  {seg.text}
                                </div>
                                {seg.audioUrl ? (
                                  <div className="flex items-center gap-2">
                                    <Music className="size-3 text-primary/60 flex-shrink-0" />
                                    <audio
                                      src={seg.audioUrl}
                                      controls
                                      className="h-5 flex-1 [&::-webkit-media-controls-panel]:bg-muted/50"
                                      style={{ minWidth: 0 }}
                                    />
                                  </div>
                                ) : (
                                  <div className="text-[10px] text-muted-foreground italic">
                                    {seg.error || '尚未生成'}
                                  </div>
                                )}
                              </div>
                            ))}
                            {/* Merged full-conversation player */}
                            {hasTts && (
                              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/40">
                                <Music className="size-3 text-primary/60 flex-shrink-0" />
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">合并音频</span>
                                <audio
                                  src={sb.ttsAudioUrl!}
                                  controls
                                  className="h-5 flex-1 [&::-webkit-media-controls-panel]:bg-muted/50"
                                  style={{ minWidth: 0 }}
                                />
                              </div>
                            )}
                          </div>
                        ) : (
                          <>
                            {/* Single-segment dialogue text */}
                            <div className="text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1.5 mb-2 line-clamp-2">
                              {sb.dialogue}
                            </div>

                            {/* Audio player */}
                            {hasTts && (
                              <div className="flex items-center gap-2 mb-2">
                                <Music className="size-3 text-primary/60 flex-shrink-0" />
                                <audio
                                  src={sb.ttsAudioUrl}
                                  controls
                                  className="h-6 flex-1 [&::-webkit-media-controls-panel]:bg-muted/50"
                                  style={{ minWidth: 0 }}
                                />
                              </div>
                            )}
                          </>
                        )}

                        {/* Action buttons */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px] px-2"
                            onClick={() => handleGenerateTts(sb)}
                            disabled={isGenerating || aiLoading}
                          >
                            {isGenerating ? <Loader2 className="size-3 animate-spin" /> : <Mic className="size-3" />}
                            {isMulti ? '生成全部段' : 'AI生成配音'}
                          </Button>
                          {!isMulti && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[10px] px-2 text-muted-foreground hover:text-foreground"
                                disabled={isUploading}
                                onClick={() => {
                                  const input = document.getElementById(`upload-tts-${sb.id}`) as HTMLInputElement
                                  input?.click()
                                }}
                              >
                                {isUploading ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
                                上传音频
                              </Button>
                              <input
                                id={`upload-tts-${sb.id}`}
                                type="file"
                                accept="audio/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0]
                                  if (file) handleUpload(file, { storyboardId: sb.id, fieldType: 'ttsAudioUrl' }, `tts-${sb.id}`)
                                  e.target.value = ''
                                }}
                              />
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      </ScrollArea>
    </motion.div>
  )
}
