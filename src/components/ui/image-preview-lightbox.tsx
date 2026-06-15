'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

// ── Constants ──────────────────────────────────────────────
const MIN_PREVIEW_SCALE = 1
const MAX_PREVIEW_SCALE = 4
const PREVIEW_SCALE_STEP = 0.25

// ── Public types ───────────────────────────────────────────
export interface ImagePreviewState {
  url: string
  alt: string
}

export interface ImagePreviewLightboxProps {
  /** Current preview. `null` closes the dialog. */
  preview: ImagePreviewState | null
  /** Called when the user dismisses the preview (Esc, X, click backdrop). */
  onClose: () => void
}

// ── Component ──────────────────────────────────────────────
/**
 * Reusable full-screen image preview with mouse-wheel zoom and drag-to-pan.
 *
 * Usage:
 * ```tsx
 * const [preview, setPreview] = useState<ImagePreviewState | null>(null)
 * <ImagePreviewLightbox preview={preview} onClose={() => setPreview(null)} />
 * ```
 */
export function ImagePreviewLightbox({ preview, onClose }: ImagePreviewLightboxProps) {
  const [scale, setScale] = useState(MIN_PREVIEW_SCALE)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ pointerX: 0, pointerY: 0, imageX: 0, imageY: 0 })

  // Reset zoom/pan whenever a new image is opened
  useEffect(() => {
    if (preview) {
      setScale(MIN_PREVIEW_SCALE)
      setPosition({ x: 0, y: 0 })
      setIsDragging(false)
    }
  }, [preview?.url]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateScale = useCallback((next: number) => {
    const clamped = Math.min(MAX_PREVIEW_SCALE, Math.max(MIN_PREVIEW_SCALE, next))
    setScale(clamped)
    if (clamped === MIN_PREVIEW_SCALE) setPosition({ x: 0, y: 0 })
  }, [])

  const reset = useCallback(() => {
    setScale(MIN_PREVIEW_SCALE)
    setPosition({ x: 0, y: 0 })
    setIsDragging(false)
  }, [])

  const handleWheel = useCallback(
    (event: React.WheelEvent) => {
      event.preventDefault()
      updateScale(scale + (event.deltaY < 0 ? PREVIEW_SCALE_STEP : -PREVIEW_SCALE_STEP))
    },
    [scale, updateScale],
  )

  const handlePointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    if (scale === MIN_PREVIEW_SCALE || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStart.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      imageX: position.x,
      imageY: position.y,
    }
    setIsDragging(true)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!isDragging) return
    setPosition({
      x: dragStart.current.imageX + event.clientX - dragStart.current.pointerX,
      y: dragStart.current.imageY + event.clientY - dragStart.current.pointerY,
    })
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!isDragging) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    setIsDragging(false)
  }

  return (
    <Dialog open={!!preview} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="z-[100] !top-0 !right-0 !bottom-0 !left-0 flex h-dvh w-screen !max-w-none !translate-x-0 !translate-y-0 touch-none items-center justify-center overflow-hidden rounded-none border-0 bg-black/95 p-3 shadow-none data-[state=closed]:!animate-none data-[state=open]:!animate-none sm:p-6"
        aria-label={preview ? `${preview.alt}全图预览` : '图片预览'}
        onClick={onClose}
        onWheel={handleWheel}
      >
        {preview && <DialogTitle className="sr-only">{preview.alt}全图预览</DialogTitle>}

        {/* Zoom control bar (top center) */}
        <div
          className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-black/70 p-1 text-white shadow-lg backdrop-blur-sm sm:top-5"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-full text-white hover:bg-white/15 hover:text-white"
            onClick={() => updateScale(scale - PREVIEW_SCALE_STEP)}
            disabled={scale <= MIN_PREVIEW_SCALE}
            aria-label="缩小图片"
            title="缩小"
          >
            <ZoomOut className="size-4" />
          </Button>
          <button
            type="button"
            className="min-w-14 rounded-full px-2 py-1 text-xs tabular-nums hover:bg-white/15"
            onClick={reset}
            aria-label="恢复适屏"
            title="恢复适屏"
          >
            {Math.round(scale * 100)}%
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-full text-white hover:bg-white/15 hover:text-white"
            onClick={() => updateScale(scale + PREVIEW_SCALE_STEP)}
            disabled={scale >= MAX_PREVIEW_SCALE}
            aria-label="放大图片"
            title="放大"
          >
            <ZoomIn className="size-4" />
          </Button>
        </div>

        {/* Close button (top right) */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-3 top-3 z-10 size-10 rounded-full bg-black/60 text-white hover:bg-white/15 hover:text-white sm:right-5 sm:top-5"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          aria-label="关闭全图预览"
          title="关闭"
        >
          <X className="size-5" />
        </Button>

        {/* The image itself */}
        {preview && (
          <img
            src={preview.url}
            alt={preview.alt}
            draggable={false}
            className={`max-h-[calc(100dvh-1.5rem)] max-w-[calc(100vw-1.5rem)] select-none object-contain sm:max-h-[calc(100dvh-3rem)] sm:max-w-[calc(100vw-3rem)] ${
              scale > MIN_PREVIEW_SCALE
                ? isDragging
                  ? 'cursor-grabbing'
                  : 'cursor-grab'
                : 'cursor-zoom-in'
            }`}
            style={{
              transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale})`,
              transition: isDragging ? 'none' : 'transform 150ms ease-out',
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (scale === MIN_PREVIEW_SCALE) {
                updateScale(MIN_PREVIEW_SCALE + PREVIEW_SCALE_STEP)
              }
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
