'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore, type Character, type Scene, type Prop, type DramaDetail } from '@/lib/store'
import { api, type ArtStyleInfo } from '@/lib/api'
import { useToast } from '@/hooks/use-toast'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Download,
  Eye,
  Filter,
  FolderOpen,
  ImageIcon,
  LayoutGrid,
  List,
  Loader2,
  Mail,
  Maximize2,
  Mountain,
  Package,
  Palette,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Users,
  X,
  Zap,
} from 'lucide-react'
import {
  ImagePreviewLightbox,
  type ImagePreviewState,
} from '@/components/ui/image-preview-lightbox'
// ── Types ──────────────────────────────────────────────────

type AssetType = 'character' | 'scene' | 'prop'
type TypeFilter = 'all' | AssetType
type ViewMode = 'grid' | 'list'
type SortKey = 'name' | 'type' | 'createdAt'

interface UnifiedAsset {
  id: string
  name: string
  type: AssetType
  description: string
  imagePrompt: string | null
  imageUrl: string | null
  cosImageUrl: string | null
  episodeIds: string
  createdAt: string
  // type-specific extra data
  raw: Character | Scene | Prop
  views?: Array<{ id: string; label: string; imageUrl: string; imagePrompt: string | null }>
}

interface BatchProgress {
  current: number
  total: number
  active: boolean
}

interface CharacterGenerationProgress {
  assetId: string
  current: number
  total: number
  label: string
}

const CHARACTER_VIEW_LABELS = ['面部特写', '全身正面', '全身背面', '全身侧面'] as const

// ── Color mapping ──────────────────────────────────────────

const TYPE_COLORS: Record<AssetType, { bg: string; text: string; border: string; accent: string; icon: typeof Users }> = {
  character: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30', accent: 'blue', icon: Users },
  scene: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', accent: 'emerald', icon: Mountain },
  prop: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/30', accent: 'orange', icon: Package },
}

const TYPE_LABELS: Record<AssetType, string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
}

// ── Main Component ─────────────────────────────────────────

export function AssetWorkbench() {
  const navigateToProject = useAppStore((s) => s.navigateToProject)
  const navigateToScriptWorkbench = useAppStore((s) => s.navigateToScriptWorkbench)
  const selectedDramaId = useAppStore((s) => s.selectedDramaId)
  const currentDrama = useAppStore((s) => s.currentDrama)
  const setCurrentDrama = useAppStore((s) => s.setCurrentDrama)
  const { toast } = useToast()

  // ── State ──
  const [drama, setDrama] = useState<DramaDetail | null>(null)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [sortKey, setSortKey] = useState<SortKey>('name')

  // Extraction state
  const [extracting, setExtracting] = useState(false)
  const [assetStatus, setAssetStatus] = useState<{
    assetStatus: string
    totalCharacters: number
    totalScenes: number
    totalProps: number
    lastExtractionAt?: string
  } | null>(null)

  // Art style state
  const [artStyles, setArtStyles] = useState<ArtStyleInfo[]>([])
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null)
  const [applyingStyle, setApplyingStyle] = useState(false)
  const [polishing, setPolishing] = useState(false)

  // Batch generation state
  const [batchProgress, setBatchProgress] = useState<BatchProgress>({ current: 0, total: 0, active: false })
  const [imageSize, setImageSize] = useState<string>('1:1')
  const [generatingAssetId, setGeneratingAssetId] = useState<string | null>(null)
  const [regeneratingView, setRegeneratingView] = useState(false)
  const [syncingToCos, setSyncingToCos] = useState(false)

  const [characterGenerationProgress, setCharacterGenerationProgress] = useState<CharacterGenerationProgress | null>(null)
  // Detail dialog state
  const [detailAsset, setDetailAsset] = useState<UnifiedAsset | null>(null)
  const [editPrompt, setEditPrompt] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [activeView, setActiveView] = useState<string>('')
  const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null)

  const openImagePreview = (url: string, alt: string) => {
    setImagePreview({ url, alt })
  }
  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<UnifiedAsset | null>(null)

  // Add manual dialog
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [addType, setAddType] = useState<AssetType>('character')
  const [addName, setAddName] = useState('')
  const [addDescription, setAddDescription] = useState('')

  // ── Data Loading ──
  const loadDrama = useCallback(async () => {
    if (!selectedDramaId) return null
    try {
      const d = await api.dramas.get(selectedDramaId)
      setDrama(d)
      setCurrentDrama(d)
      setSelectedStyle(d.artStyle)
      return d
    } catch {
      // Drama may not exist
      return null
    }
  }, [selectedDramaId, setCurrentDrama])

  const loadExtractStatus = useCallback(async () => {
    if (!selectedDramaId) return
    try {
      const status = await api.dramas.getExtractStatus(selectedDramaId)
      setAssetStatus(status)
    } catch {
      // Ignore
    }
  }, [selectedDramaId])

  const loadArtStyles = useCallback(async () => {
    if (!selectedDramaId) return
    try {
      const result = await api.artStyle.list(selectedDramaId)
      setArtStyles(result.styles)
    } catch {
      // Ignore
    }
  }, [selectedDramaId])

  useEffect(() => {
    loadDrama()
    loadExtractStatus()
    loadArtStyles()
  }, [loadDrama, loadExtractStatus, loadArtStyles])

  const allAssets = useMemo<UnifiedAsset[]>(() => {
    if (!drama) return []
    const assets: UnifiedAsset[] = []
    for (const c of drama.characters || []) {
      const appearances = (c as any).appearances || []
      const views = appearances
        .filter((a: any) => a.imageUrl)
        .map((a: any) => ({
          id: a.id,
          label: a.label,
          imageUrl: a.imageUrl,
          imagePrompt: a.imagePrompt || null,
        }))

      assets.push({
        id: c.id,
        name: c.name,
        type: 'character',
        description: c.appearance || c.personality || '',
        imagePrompt: c.imagePrompt,
        imageUrl: c.imageUrl,
        cosImageUrl: c.cosImageUrl,
        episodeIds: c.episodeIds,
        createdAt: c.createdAt,
        raw: c,
        views,
      })
    }

    for (const s of drama.scenes || []) {
      assets.push({
        id: s.id,
        name: s.location,
        type: 'scene',
        description: s.description || '',
        imagePrompt: s.prompt || null,
        imageUrl: s.imageUrl,
        episodeIds: s.episodeIds,
        createdAt: s.createdAt,
        raw: s,
      })
    }

    for (const p of drama.props || []) {
      assets.push({
        id: p.id,
        name: p.name,
        type: 'prop',
        description: p.description || '',
        imagePrompt: p.imagePrompt,
        imageUrl: p.imageUrl,
        episodeIds: '',
        createdAt: p.createdAt,
        raw: p,
      })
    }

    return assets
  }, [drama])

  // ── Filtered + sorted assets ──
  const filteredAssets = useMemo(() => {
    let result = allAssets

    if (typeFilter !== 'all') {
      result = result.filter((a) => a.type === typeFilter)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q)
      )
    }

    result.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'type':
          return a.type.localeCompare(b.type)
        case 'createdAt':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        default:
          return 0
      }
    })

    return result
  }, [allAssets, typeFilter, searchQuery, sortKey])

  // ── Counts ──
  const counts = useMemo(() => {
    const chars = allAssets.filter((a) => a.type === 'character').length
    const scenes = allAssets.filter((a) => a.type === 'scene').length
    const props = allAssets.filter((a) => a.type === 'prop').length
    return { all: allAssets.length, character: chars, scene: scenes, prop: props }
  }, [allAssets])

  // ── Handlers ──

  const handleExtractAll = async () => {
    if (!selectedDramaId) return
    setExtracting(true)
    try {
      const result = await api.dramas.extractAssets(selectedDramaId)
      toast({
        title: '素材提取完成',
        description: `角色 ${result.characters} / 场景 ${result.scenes} / 道具 ${result.props}`,
      })
      await loadDrama()
      await loadExtractStatus()
    } catch (err: any) {
      toast({ title: '提取失败', description: err.message, variant: 'destructive' })
    } finally {
      setExtracting(false)
    }
  }

  const handleReExtract = async () => {
    if (!selectedDramaId) return
    setExtracting(true)
    try {
      const result = await api.dramas.extractAssets(selectedDramaId)
      toast({
        title: '重新提取完成',
        description: `角色 ${result.characters} / 场景 ${result.scenes} / 道具 ${result.props}`,
      })
      await loadDrama()
      await loadExtractStatus()
    } catch (err: any) {
      toast({ title: '重新提取失败', description: err.message, variant: 'destructive' })
    } finally {
      setExtracting(false)
    }
  }

  const handleApplyStyle = async () => {
    if (!selectedDramaId || !selectedStyle) return
    setApplyingStyle(true)
    try {
      await api.artStyle.set(selectedDramaId, selectedStyle)
      toast({ title: '风格已应用', description: `当前风格: ${selectedStyle}` })
      await loadDrama()
    } catch (err: any) {
      toast({ title: '设置风格失败', description: err.message, variant: 'destructive' })
    } finally {
      setApplyingStyle(false)
    }
  }

  const handlePolishAll = async () => {
    if (!selectedDramaId) return
    setPolishing(true)
    try {
      const result = await api.dramas.polishPrompts(selectedDramaId, selectedStyle || undefined, true)
      toast({
        title: '提示词润色完成',
        description: `润色 ${result.polished} 个，跳过 ${result.skipped} 个`,
      })
      await loadDrama()
    } catch (err: any) {
      toast({ title: '润色失败', description: err.message, variant: 'destructive' })
    } finally {
      setPolishing(false)
    }
  }

  const handleBatchGenerate = async () => {
    if (!selectedDramaId) return
    const assetsToGenerate = filteredAssets.filter((a) => !a.imageUrl)
    if (assetsToGenerate.length === 0) {
      toast({ title: '没有需要生成的素材', description: '所有筛选结果都已有图片' })
      return
    }

    setBatchProgress({ current: 0, total: assetsToGenerate.length, active: true })

    const concurrencyLimit = 2
    let current = 0

    const processAsset = async (asset: UnifiedAsset) => {
      try {
        const style = selectedStyle || undefined
        if (asset.type === 'character') {
          await api.ai.generateCharacterImage(asset.id, style)
        } else if (asset.type === 'scene') {
          await api.ai.generateSceneImage(asset.id, style)
        } else if (asset.type === 'prop' && asset.imagePrompt) {
          await api.ai.generateImage(asset.imagePrompt, imageSize, undefined, undefined, undefined, { propId: asset.id })
        }
      } catch (err: any) {
        console.error(`Failed to generate image for ${asset.name}:`, err)
      } finally {
        current++
        setBatchProgress((prev) => ({ ...prev, current }))
      }
    }

    // Process with concurrency limit
    const queue = [...assetsToGenerate]
    const workers: Promise<void>[] = []

    for (let i = 0; i < concurrencyLimit; i++) {
      workers.push(
        (async () => {
          while (queue.length > 0) {
            const asset = queue.shift()
            if (asset) await processAsset(asset)
          }
        })()
      )
    }

    await Promise.all(workers)

    setBatchProgress((prev) => ({ ...prev, active: false }))
    toast({ title: '批量生成完成', description: `已处理 ${assetsToGenerate.length} 个素材` })
    await loadDrama()
  }

  const handleGenerateSingle = async (asset: UnifiedAsset) => {
    const style = selectedStyle || undefined
    setGeneratingAssetId(asset.id)
    try {
      if (asset.type === 'character') {
        let faceReferenceUrl: string | undefined
        let fullBodyReferenceUrl: string | undefined

        for (let index = 0; index < CHARACTER_VIEW_LABELS.length; index++) {
          const label = CHARACTER_VIEW_LABELS[index]
          setCharacterGenerationProgress({
            assetId: asset.id,
            current: index + 1,
            total: CHARACTER_VIEW_LABELS.length,
            label,
          })

          const referenceUrl = label === '全身正面'
            ? faceReferenceUrl
            : label === '全身背面' || label === '全身侧面'
              ? fullBodyReferenceUrl || faceReferenceUrl
              : undefined
          const result = await api.ai.generateCharacterImage(
            asset.id,
            style,
            label,
            referenceUrl ? [referenceUrl] : undefined
          )
          if (result.status === 'processing') {
            throw new Error('图片供应商返回了异步任务，当前角色视图暂无法自动保存，请稍后重试')
          }
          if (!result.appearance || !result.imageUrl) {
            throw new Error(`「${label}」生成结果为空`)
          }
          if (label === '面部特写') {
            faceReferenceUrl = result.sourceReferenceUrl
          } else if (label === '全身正面') {
            fullBodyReferenceUrl = result.sourceReferenceUrl
          }

          const generatedView = {
            id: result.appearance.id,
            label,
            imageUrl: result.imageUrl,
            imagePrompt: result.appearance.imagePrompt || null,
          }
          setDetailAsset((previous) => {
            if (!previous || previous.id !== asset.id) return previous
            const views = [
              ...(previous.views || []).filter((view) => view.label !== label),
              generatedView,
            ].sort(
              (left, right) =>
                CHARACTER_VIEW_LABELS.indexOf(left.label as typeof CHARACTER_VIEW_LABELS[number]) -
                CHARACTER_VIEW_LABELS.indexOf(right.label as typeof CHARACTER_VIEW_LABELS[number])
            )
            return {
              ...previous,
              imageUrl: label === '面部特写' ? result.imageUrl! : previous.imageUrl,
              views,
            }
          })
          setActiveView(label)
        }
      } else if (asset.type === 'scene') {
        const result = await api.ai.generateSceneImage(asset.id, style)
        setDetailAsset((previous) => previous && previous.id === asset.id ? {
          ...previous,
          imageUrl: result.imageUrl,
          raw: result.scene,
        } : previous)
        const references = [
          ...(result.references?.characters || []),
          ...(result.references?.props || []),
        ]
        toast({
          title: '图片生成完成',
          description: references.length > 0
            ? `已参考：${references.join('、')}`
            : '该场景未匹配到已有角色或道具素材',
        })
      } else if (asset.type === 'prop' && asset.imagePrompt) {
        const result = await api.ai.generateImage(asset.imagePrompt, imageSize, undefined, undefined, undefined, { propId: asset.id })
        setDetailAsset((previous) => previous && previous.id === asset.id
          ? { ...previous, imageUrl: result.imageUrl }
          : previous)
      }
      if (asset.type !== 'scene') {
        toast({ title: '图片生成完成' })
      }
      const refreshedDrama = await loadDrama()
      if (asset.type === 'character' && refreshedDrama) {
        const freshCharacter = refreshedDrama.characters?.find((character) => character.id === asset.id)
        if (freshCharacter) {
          setDetailAsset((previous) => previous && previous.id === asset.id ? {
            ...previous,
            description: freshCharacter.appearance || freshCharacter.personality || '',
            imagePrompt: freshCharacter.imagePrompt,
            imageUrl: freshCharacter.imageUrl,
            cosImageUrl: freshCharacter.cosImageUrl,
            raw: freshCharacter,
            views: appearances
              .filter((appearance: any) => appearance.imageUrl)
              .map((appearance: any) => ({
                id: appearance.id,
                label: appearance.label,
                imageUrl: appearance.imageUrl,
                imagePrompt: appearance.imagePrompt || null,
              })),
          } : previous)
          setEditPrompt(freshCharacter.imagePrompt || '')
        }
      }
    } catch (err: any) {
      toast({ title: '生成失败', description: err.message, variant: 'destructive' })
    } finally {
      setGeneratingAssetId(null)
      setCharacterGenerationProgress(null)
    }
  }

  const handleRegenerateView = async () => {
    if (!detailAsset || !activeView || !selectedDramaId) return
    setRegeneratingView(true)
    try {
      const faceView = detailAsset.views?.find((view) => view.label === '面部特写')
      let referenceUrl: string | undefined
      if (activeView !== '面部特写' && faceView?.imageUrl && typeof window !== 'undefined') {
        const absoluteUrl = new URL(faceView.imageUrl, window.location.origin)
        if (!['localhost', '127.0.0.1', '::1'].includes(absoluteUrl.hostname)) {
          referenceUrl = absoluteUrl.toString()
        }
      }
      const result = await api.ai.generateCharacterImage(
        detailAsset.id,
        selectedStyle || undefined,
        activeView,
        referenceUrl ? [referenceUrl] : undefined
      )
      if (result.status === 'processing') {
        throw new Error('图片供应商返回了异步任务，当前视图暂无法自动保存，请稍后重试')
      }
      if (!result.appearance || !result.imageUrl) {
        throw new Error(`「${activeView}」生成结果为空`)
      }

      const generatedView = {
        id: result.appearance.id,
        label: activeView,
        imageUrl: result.imageUrl,
        imagePrompt: result.appearance.imagePrompt || null,
      }
      setDetailAsset((previous) => previous ? {
        ...previous,
        imageUrl: activeView === '面部特写' ? result.imageUrl! : previous.imageUrl,
        views: [
          ...(previous.views || []).filter((view) => view.label !== activeView),
          generatedView,
        ].sort(
          (left, right) =>
            CHARACTER_VIEW_LABELS.indexOf(left.label as typeof CHARACTER_VIEW_LABELS[number]) -
            CHARACTER_VIEW_LABELS.indexOf(right.label as typeof CHARACTER_VIEW_LABELS[number])
        ),
      } : null)
      toast({ title: `「${activeView}」已重新生成` })
      const refreshedDrama = await loadDrama()
      const freshCharacter = refreshedDrama?.characters?.find(
        (character) => character.id === detailAsset.id
      )
      if (freshCharacter) {
        setDetailAsset((previous) => previous ? {
          ...previous,
          imagePrompt: freshCharacter.imagePrompt,
          cosImageUrl: freshCharacter.cosImageUrl,
          raw: freshCharacter,
        } : null)
        setEditPrompt(freshCharacter.imagePrompt || '')
      }
    } catch (err: any) {
      toast({ title: '生成失败', description: err.message, variant: 'destructive' })
    } finally {
      setRegeneratingView(false)
    }
  }

  const handleDeleteAsset = async (asset: UnifiedAsset) => {
    setDeleteTarget(asset)
  }

  const confirmDelete = async () => {
    const asset = deleteTarget
    if (!asset) return
    setDeleteTarget(null)
    try {
      if (asset.type === 'character') {
        await api.characters.delete(asset.id)
        toast({ title: `角色「${asset.name}」已删除` })
      } else if (asset.type === 'scene') {
        toast({ title: '场景暂不支持删除' })
        return
      } else if (asset.type === 'prop') {
        await api.props.delete(asset.id)
        toast({ title: `道具「${asset.name}」已删除` })
      }
      await loadDrama()
      await loadExtractStatus()
    } catch (err: any) {
      toast({ title: '删除失败', description: err.message, variant: 'destructive' })
    }
  }

  const handleAddManual = async () => {
    if (!selectedDramaId || !addName.trim()) return
    try {
      if (addType === 'character') {
        await api.characters.create(selectedDramaId, {
          name: addName,
          appearance: addDescription,
          role: 'supporting',
          gender: 'unknown',
        })
      } else if (addType === 'scene') {
        await api.scenes.create(selectedDramaId, {
          location: addName,
          description: addDescription,
        })
      } else if (addType === 'prop') {
        await api.props.create(selectedDramaId, {
          name: addName,
          description: addDescription,
          category: 'other',
        })
      }
      toast({ title: '素材已添加' })
      setShowAddDialog(false)
      setAddName('')
      setAddDescription('')
      await loadDrama()
    } catch (err: any) {
      toast({ title: '添加失败', description: err.message, variant: 'destructive' })
    }
  }

  const handleOpenDetail = (asset: UnifiedAsset) => {
    setDetailAsset(asset)
    setEditPrompt(asset.imagePrompt || '')
    setIsEditing(false)
    // Set initial view tab for characters
    if (asset.type === 'character' && asset.views && asset.views.length > 0) {
      const initialView = asset.views[0]
      setActiveView(initialView.label)
    } else {
      setActiveView('')
    }
  }

  const handleSavePrompt = async () => {
    if (!detailAsset || !selectedDramaId) return
    try {
      if (detailAsset.type === 'character') {
        await api.characters.update(selectedDramaId, detailAsset.id, {
          imagePrompt: editPrompt,
        })
        setDetailAsset((previous) => previous ? {
          ...previous,
          imagePrompt: editPrompt,
        } : null)
      } else if (detailAsset.type === 'scene') {
        // Scene updates through scene images API or patch
      } else if (detailAsset.type === 'prop') {
        await api.props.update(detailAsset.id, { imagePrompt: editPrompt })
      }
      toast({ title: '提示词已保存' })
      setIsEditing(false)
      await loadDrama()
    } catch (err: any) {
      toast({ title: '保存失败', description: err.message, variant: 'destructive' })
    }
  }

  const handleSyncToCos = async () => {
    if (!detailAsset || detailAsset.type !== 'character') return
    setSyncingToCos(true)
    try {
      const response = await api.characters.syncToCos(detailAsset.id)
      if (response.success && response.result.cosImageUrl) {
        setDetailAsset((previous) => previous ? {
          ...previous,
          cosImageUrl: response.result.cosImageUrl,
        } : null)
      }
      toast({ title: '同步完成', description: response.message })
      await loadDrama()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast({ title: '同步失败', description: message, variant: 'destructive' })
    } finally {
      setSyncingToCos(false)
    }
  }

  // ── Render helpers ──

  const getExtractStatusBadge = () => {
    if (!assetStatus) return null
    const status = assetStatus.assetStatus
    if (status === 'ready') {
      return (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-emerald-600 border-emerald-300">
          <Check className="size-3 mr-0.5" />
          已提取
        </Badge>
      )
    }
    if (status === 'partial') {
      return (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-600 border-amber-300">
          部分
        </Badge>
      )
    }
    if (status === 'extracting') {
      return (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-blue-600 border-blue-300">
          <Loader2 className="size-3 mr-0.5 animate-spin" />
          提取中
        </Badge>
      )
    }
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
        待提取
      </Badge>
    )
  }

  // ── Render ──

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 顶部导航 + 面包屑 */}
      <div className="h-12 border-b border-border flex items-center px-4 gap-3 shrink-0">
        {/* Breadcrumb: 项目名 > 剧本生成工作台 > 素材管理工作台 */}
        <button
          onClick={() => selectedDramaId && navigateToProject(selectedDramaId)}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors truncate max-w-28"
        >
          {currentDrama?.title || '项目'}
        </button>
        <ChevronRight className="size-3.5 text-muted-foreground/50 shrink-0" />
        <button
          onClick={() => selectedDramaId && navigateToScriptWorkbench(selectedDramaId)}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          剧本生成
        </button>
        <ChevronRight className="size-3.5 text-muted-foreground/50 shrink-0" />
        <div className="flex items-center gap-1.5">
          <Palette className="size-4 text-amber-500" />
          <span className="text-sm font-medium">素材管理工作台</span>
        </div>
        {(extracting || polishing || batchProgress.active) && (
          <Badge variant="outline" className="text-[10px] px-2 py-0 text-amber-600 border-amber-300">
            <Loader2 className="size-3 mr-1 animate-spin" />
            处理中...
          </Badge>
        )}
        {!extracting && !polishing && !batchProgress.active && (
          <div className="ml-auto" />
        )}
        <Button
          variant="outline"
          size="sm"
          className="hidden sm:inline-flex text-xs gap-1"
          onClick={() => selectedDramaId && navigateToProject(selectedDramaId)}
        >
          进入管线 →
        </Button>
        {/* Mobile drawer toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="size-8 p-0 lg:hidden"
          onClick={() => setLeftCollapsed(!leftCollapsed)}
        >
          {leftCollapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </Button>
      </div>

      {/* 主体两栏布局 */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── 左工具面板 (slide-out drawer on < lg) ── */}
        <div
          className={`shrink-0 border-r border-border flex flex-col transition-all duration-200 ${
            leftCollapsed ? 'w-10' : 'w-80'
          } hidden lg:flex`}
        >
          {leftCollapsed ? (
            <div className="flex flex-col items-center py-2 gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="size-8 p-0"
                onClick={() => setLeftCollapsed(false)}
              >
                <ChevronRight className="size-4" />
              </Button>
              <div className="mt-2 [writing-mode:vertical-rl] text-xs text-muted-foreground">
                工具面板
              </div>
            </div>
          ) : (
            <>
              {/* 面板头 */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Zap className="size-3 text-amber-500" />
                  工具面板
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-6 p-0"
                  onClick={() => setLeftCollapsed(true)}
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-3 space-y-4">
                  {/* 1. Extract Actions */}
                  <section>
                    <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                      <FolderOpen className="size-3" />
                      素材提取
                      {getExtractStatusBadge()}
                    </div>
                    <div className="space-y-1.5">
                      <Button
                        size="sm"
                        className="w-full h-7 text-xs gap-1.5"
                        onClick={handleExtractAll}
                        disabled={extracting}
                      >
                        {extracting ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Download className="size-3" />
                        )}
                        提取全部素材
                      </Button>
                      {assetStatus && assetStatus.assetStatus !== 'pending' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full h-7 text-xs gap-1.5"
                          onClick={handleReExtract}
                          disabled={extracting}
                        >
                          <RotateCcw className="size-3" />
                          重新提取
                        </Button>
                      )}
                    </div>
                    {assetStatus && (
                      <div className="mt-2 text-[10px] text-muted-foreground space-y-0.5">
                        <div>角色: {assetStatus.totalCharacters} · 场景: {assetStatus.totalScenes} · 道具: {assetStatus.totalProps}</div>
                        {assetStatus.lastExtractionAt && (
                          <div>上次提取: {new Date(assetStatus.lastExtractionAt).toLocaleString()}</div>
                        )}
                      </div>
                    )}
                  </section>

                  <Separator />

                  {/* 2. Type Filter */}
                  <section>
                    <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Filter className="size-3" />
                      类型筛选
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(['all', 'character', 'scene', 'prop'] as TypeFilter[]).map((type) => {
                        const count = type === 'all' ? counts.all : counts[type]
                        const isActive = typeFilter === type
                        const label = type === 'all' ? '全部' : TYPE_LABELS[type]
                        return (
                          <button
                            key={type}
                            className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors border ${
                              isActive
                                ? 'bg-amber-500/15 text-amber-600 border-amber-500/30'
                                : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted'
                            }`}
                            onClick={() => setTypeFilter(type)}
                          >
                            {label} ({count})
                          </button>
                        )
                      })}
                    </div>
                  </section>

                  <Separator />

                  {/* 3. Style Selector */}
                  <section>
                    <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Palette className="size-3" />
                      艺术风格
                      {selectedStyle && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 text-amber-600 border-amber-300 ml-auto">
                          已选
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
                      {artStyles.map((style) => (
                        <button
                          key={style.key}
                          className={`relative p-2 rounded-lg border text-left transition-all hover:bg-muted/50 ${
                            selectedStyle === style.key
                              ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30'
                              : 'border-border/50'
                          }`}
                          onClick={() => setSelectedStyle(style.key)}
                        >
                          {/* Style thumbnail or icon placeholder */}
                          <div className="size-full min-h-[40px] rounded-md bg-gradient-to-br from-muted/80 to-muted/40 flex items-center justify-center mb-1.5">
                            <Palette className="size-4 text-muted-foreground/60" />
                          </div>
                          <div className="text-[10px] font-medium leading-tight truncate">
                            {style.name}
                          </div>
                          {selectedStyle === style.key && (
                            <div className="absolute top-1 right-1 size-4 rounded-full bg-amber-500 flex items-center justify-center">
                              <Check className="size-2.5 text-white" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 space-y-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-7 text-xs gap-1.5"
                        onClick={handleApplyStyle}
                        disabled={!selectedStyle || applyingStyle}
                      >
                        {applyingStyle ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Check className="size-3" />
                        )}
                        应用风格
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-7 text-xs gap-1.5"
                        onClick={handlePolishAll}
                        disabled={polishing}
                      >
                        {polishing ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Sparkles className="size-3" />
                        )}
                        润色全部提示词
                      </Button>
                    </div>
                  </section>

                  <Separator />

                  {/* 4. Batch Generate */}
                  <section>
                    <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                      <ImageIcon className="size-3" />
                      批量生成
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground w-10 shrink-0">比例</span>
                        <Select value={imageSize} onValueChange={setImageSize}>
                          <SelectTrigger className="h-7 text-xs flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1:1">1:1 方形</SelectItem>
                            <SelectItem value="3:4">3:4 竖版</SelectItem>
                            <SelectItem value="4:3">4:3 横版</SelectItem>
                            <SelectItem value="9:16">9:16 手机</SelectItem>
                            <SelectItem value="16:9">16:9 宽屏</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        size="sm"
                        className="w-full h-7 text-xs gap-1.5"
                        onClick={handleBatchGenerate}
                        disabled={batchProgress.active || filteredAssets.length === 0}
                      >
                        {batchProgress.active ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Play className="size-3" />
                        )}
                        生成选中素材
                      </Button>
                      {batchProgress.active && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span>进度</span>
                            <span>{batchProgress.current}/{batchProgress.total}</span>
                          </div>
                          <Progress
                            value={
                              batchProgress.total > 0
                                ? (batchProgress.current / batchProgress.total) * 100
                                : 0
                            }
                            className="h-1.5"
                          />
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              </ScrollArea>
            </>
          )}
        </div>

        {/* ── Mobile drawer for left tool panel (< lg) ── */}
        {!leftCollapsed && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <div className="flex-1 bg-black/50" onClick={() => setLeftCollapsed(true)} />
            <div className="w-80 bg-background border-l border-border flex flex-col overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Zap className="size-3 text-amber-500" />
                  工具面板
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-6 p-0"
                  onClick={() => setLeftCollapsed(true)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-3 space-y-4">
                  <section>
                    <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                      <FolderOpen className="size-3" />
                      素材提取
                      {getExtractStatusBadge()}
                    </div>
                    <div className="space-y-1.5">
                      <Button
                        size="sm"
                        className="w-full h-7 text-xs gap-1.5"
                        onClick={() => { handleExtractAll(); setLeftCollapsed(true) }}
                        disabled={extracting}
                      >
                        {extracting ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
                        提取全部素材
                      </Button>
                    </div>
                  </section>
                  <Separator />
                  <section>
                    <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Filter className="size-3" />
                      类型筛选
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(['all', 'character', 'scene', 'prop'] as TypeFilter[]).map((type) => {
                        const count = type === 'all' ? counts.all : counts[type]
                        const isActive = typeFilter === type
                        const label = type === 'all' ? '全部' : TYPE_LABELS[type]
                        return (
                          <button
                            key={type}
                            className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors border ${
                              isActive ? 'bg-amber-500/15 text-amber-600 border-amber-500/30' : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted'
                            }`}
                            onClick={() => { setTypeFilter(type); setLeftCollapsed(true) }}
                          >
                            {label} ({count})
                          </button>
                        )
                      })}
                    </div>
                  </section>
                </div>
              </ScrollArea>
            </div>
          </div>
        )}

        {/* ── 右素材面板 ── */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Header bar */}
          <div className="border-b border-border px-4 py-2 flex items-center gap-3 shrink-0">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                placeholder="搜索素材名称/描述..."
                className="h-7 text-xs pl-7"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                size="sm"
                className="size-7 p-0"
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid className="size-3.5" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                size="sm"
                className="size-7 p-0"
                onClick={() => setViewMode('list')}
              >
                <List className="size-3.5" />
              </Button>
            </div>
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="h-7 text-xs w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">按名称</SelectItem>
                <SelectItem value="type">按类型</SelectItem>
                <SelectItem value="createdAt">按时间</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setShowAddDialog(true)}
            >
              <Plus className="size-3" />
              手动添加
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="size-7 p-0"
              onClick={() => { loadDrama(); loadExtractStatus() }}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>

          {/* Asset Grid / List */}
          <div className="flex-1 overflow-y-auto">
            {filteredAssets.length > 0 ? (
              viewMode === 'grid' ? (
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {filteredAssets.map((asset) => (
                    <AssetCard
                      key={`${asset.type}-${asset.id}`}
                      asset={asset}
                      onOpen={handleOpenDetail}
                      onGenerate={handleGenerateSingle}
                      onDelete={handleDeleteAsset}
                      generating={generatingAssetId === asset.id}
                    />
                  ))}
                </div>
              ) : (
                <div className="p-4 space-y-2">
                  {filteredAssets.map((asset) => (
                    <AssetListItem
                      key={`${asset.type}-${asset.id}`}
                      asset={asset}
                      onOpen={handleOpenDetail}
                      onGenerate={handleGenerateSingle}
                      onDelete={handleDeleteAsset}
                      generating={generatingAssetId === asset.id}
                    />
                  ))}
                </div>
              )
            ) : (
              <div className="flex-1 flex items-center justify-center h-64">
                <div className="text-center space-y-3">
                  <Palette className="size-12 mx-auto text-amber-500/30" />
                  <div>
                    <h3 className="text-sm font-medium">暂无素材</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      从剧本提取素材或手动添加
                    </p>
                  </div>
                  <div className="flex gap-2 justify-center">
                    <Button
                      size="sm"
                      className="text-xs gap-1"
                      onClick={handleExtractAll}
                      disabled={extracting}
                    >
                      <Download className="size-3" />
                      提取素材
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs gap-1"
                      onClick={() => setShowAddDialog(true)}
                    >
                      <Plus className="size-3" />
                      手动添加
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Asset Detail Dialog ── */}
      <Dialog open={!!detailAsset} onOpenChange={(open) => !open && setDetailAsset(null)}>
        <DialogContent className="max-w-lg">
          {detailAsset && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {(() => {
                    const Icon = TYPE_COLORS[detailAsset.type].icon
                    return <Icon className="size-4" />
                  })()}
                  {detailAsset.name}
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 ${TYPE_COLORS[detailAsset.type].text} ${TYPE_COLORS[detailAsset.type].border}`}
                  >
                    {TYPE_LABELS[detailAsset.type]}
                  </Badge>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {/* View Tabs (only for characters with multiple views) */}
                {detailAsset.type === 'character' && detailAsset.views && detailAsset.views.length > 0 && (
                  <div className="flex gap-1 border-b pb-2 mb-4 overflow-x-auto">
                    {detailAsset.views.map((v) => (
                      <button
                        key={v.label}
                        className={`px-3 py-1.5 text-xs rounded-t-md whitespace-nowrap transition-colors ${
                          activeView === v.label
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted hover:bg-muted/80'
                        }`}
                        onClick={() => {
                          setActiveView(v.label)
                          setIsEditing(false)
                        }}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}
                {/* Image */}
                {(() => {
                  const currentView = detailAsset.type === 'character' && activeView && detailAsset.views
                    ? detailAsset.views.find(v => v.label === activeView)
                    : null
                  const displayUrl = currentView?.imageUrl || detailAsset.imageUrl
                  const displayAlt = currentView
                    ? `${detailAsset.name} - ${currentView.label}`
                    : detailAsset.name

                  return displayUrl ? (
                    <button
                      type="button"
                      className="group relative block w-full cursor-zoom-in overflow-hidden rounded-lg border border-border/50 bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      onClick={() => openImagePreview(displayUrl, displayAlt)}
                      aria-label={`查看${displayAlt}全图`}
                      title="查看全图"
                    >
                      <img
                        src={displayUrl}
                        alt={displayAlt}
                        className="w-full max-h-64 object-contain transition-[filter] group-hover:brightness-75"
                      />
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/20 group-hover:opacity-100 group-focus-visible:bg-black/20 group-focus-visible:opacity-100">
                        <span className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
                          <Maximize2 className="size-3.5" />
                          查看全图
                        </span>
                      </span>
                    </button>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border/50 bg-muted/20 h-40 flex items-center justify-center">
                      <div className="text-center">
                        <ImageIcon className="size-8 mx-auto text-muted-foreground/30" />
                        <p className="text-xs text-muted-foreground mt-1">暂无图片</p>
                      </div>
                    </div>
                  )
                })()}

                {/* Description */}
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">描述</div>
                  <p className="text-sm leading-relaxed">
                    {detailAsset.description || '暂无描述'}
                  </p>
                </div>

                {/* Episode tags */}
                {detailAsset.episodeIds && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">出现集数</div>
                    <div className="flex flex-wrap gap-1">
                      {(() => {
                        try {
                          const ids = JSON.parse(detailAsset.episodeIds)
                          if (Array.isArray(ids)) {
                            return ids.map((id: string, idx: number) => (
                              <Badge key={id} variant="secondary" className="text-[10px] px-1.5 py-0">
                                E{idx + 1}
                              </Badge>
                            ))
                          }
                        } catch {}
                        return <span className="text-xs text-muted-foreground">—</span>
                      })()}
                    </div>
                  </div>
                )}

                {/* Asset-level prompt (editable) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs font-medium text-muted-foreground">
                      {detailAsset.type === 'character' ? '角色提示词' : '图片提示词'}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-6 p-0"
                      onClick={() => setIsEditing(!isEditing)}
                    >
                      {isEditing ? <Check className="size-3" /> : <Pencil className="size-3" />}
                    </Button>
                  </div>
                  {isEditing ? (
                    <Textarea
                      value={editPrompt}
                      onChange={(e) => setEditPrompt(e.target.value)}
                      className="min-h-[100px] text-xs font-mono"
                      placeholder={detailAsset.type === 'character' ? '输入角色提示词...' : '输入图片提示词...'}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground bg-muted/30 rounded-md p-2 max-h-32 overflow-y-auto">
                      {detailAsset.imagePrompt || '暂无提示词'}
                    </p>
                  )}
                </div>

                {detailAsset.type === 'character' && activeView && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      「{activeView}」视图生成提示词
                    </div>
                    <p className="text-xs text-muted-foreground bg-muted/30 rounded-md p-2 max-h-32 overflow-y-auto">
                      {detailAsset.views?.find((view) => view.label === activeView)?.imagePrompt || '暂无提示词'}
                    </p>
                  </div>
                )}

                {characterGenerationProgress?.assetId === detailAsset.id && (
                  <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="size-3 animate-spin" />
                        正在生成 {characterGenerationProgress.current}/{characterGenerationProgress.total}：
                        {characterGenerationProgress.label}
                      </span>
                      <span className="text-muted-foreground">
                        {Math.round(
                          ((characterGenerationProgress.current - 1) /
                            characterGenerationProgress.total) *
                            100
                        )}%
                      </span>
                    </div>
                    <Progress
                      value={
                        ((characterGenerationProgress.current - 1) /
                          characterGenerationProgress.total) *
                        100
                      }
                    />
                  </div>
                )}
              </div>
              <DialogFooter className="gap-2">
                {detailAsset.type === 'character' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1"
                    onClick={handleSyncToCos}
                    disabled={syncingToCos || !detailAsset.imageUrl || Boolean(detailAsset.cosImageUrl)}
                    title={detailAsset.cosImageUrl ? '已同步到云端' : '同步角色图片到腾讯云 COS'}
                  >
                    {syncingToCos ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <CloudUpload className="size-3" />
                    )}
                    {detailAsset.cosImageUrl ? '已同步' : '同步到云端'}
                  </Button>
                )}
                {detailAsset.type === 'character' && activeView && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1"
                    onClick={handleRegenerateView}
                    disabled={regeneratingView || generatingAssetId === detailAsset.id}
                  >
                    {regeneratingView ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3" />
                    )}
                    {regeneratingView ? `正在生成「${activeView}」` : `重新生成「${activeView}」`}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1"
                  onClick={() => handleGenerateSingle(detailAsset)}
                  disabled={generatingAssetId === detailAsset.id || regeneratingView}
                >
                  {generatingAssetId === detailAsset.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3" />
                  )}
                  {characterGenerationProgress?.assetId === detailAsset.id
                    ? `生成中 ${characterGenerationProgress.current}/${characterGenerationProgress.total}`
                    : '生成图片'}
                </Button>
                {isEditing && (
                  <Button
                    size="sm"
                    className="text-xs gap-1"
                    onClick={handleSavePrompt}
                  >
                    保存提示词
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      {/* Full-screen image preview (zoom + pan) */}
      <ImagePreviewLightbox
        preview={imagePreview}
        onClose={() => setImagePreview(null)}
      />

      {/* ── Add Manual Dialog ── */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>手动添加素材</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">类型</div>
              <Select value={addType} onValueChange={(v) => setAddType(v as AssetType)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="character">角色</SelectItem>
                  <SelectItem value="scene">场景</SelectItem>
                  <SelectItem value="prop">道具</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">名称</div>
              <Input
                className="h-8 text-xs"
                placeholder={addType === 'scene' ? '场景地点' : '素材名称'}
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
              />
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">描述</div>
              <Textarea
                className="text-xs min-h-[60px]"
                placeholder="外观描述..."
                value={addDescription}
                onChange={(e) => setAddDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setShowAddDialog(false)}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="text-xs gap-1"
              onClick={handleAddManual}
              disabled={!addName.trim()}
            >
              <Plus className="size-3" />
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除{deleteTarget && (
                <>{deleteTarget.type === 'character' ? '角色' : deleteTarget.type === 'scene' ? '场景' : '道具'}
                「<span className="font-medium">{deleteTarget.name}</span>」</>
              )}吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive hover:bg-destructive/90">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ── Asset Card (Grid View) ────────────────────────────────

function AssetCard({
  asset,
  onOpen,
  onGenerate,
  onDelete,
  generating,
}: {
  asset: UnifiedAsset
  onOpen: (a: UnifiedAsset) => void
  onGenerate: (a: UnifiedAsset) => void
  onDelete: (a: UnifiedAsset) => void
  generating: boolean
}) {
  const colors = TYPE_COLORS[asset.type]
  const Icon = colors.icon
  const hasViews = asset.type === 'character' && asset.views && asset.views.length > 1
  const [viewIndex, setViewIndex] = useState(0)
  const displayUrl = hasViews ? asset.views![viewIndex]?.imageUrl : asset.imageUrl

  return (
    <Card
      className="border-border/50 hover:border-border transition-colors cursor-pointer group"
      onClick={() => onOpen(asset)}
    >
      <CardContent className="p-3 space-y-2">
        {/* Image / Placeholder */}
        <div className="aspect-square rounded-md overflow-hidden bg-muted/30 relative">
          {displayUrl ? (
            <img
              src={displayUrl}
              alt={asset.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className={`w-full h-full flex items-center justify-center ${colors.bg}`}>
              <Icon className={`size-8 ${colors.text} opacity-50`} />
            </div>
          )}
          {/* View indicator dots (only for characters with multiple views) */}
          {hasViews && (
            <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1">
              {asset.views!.map((v, i) => (
                <button
                  key={v.label}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i === viewIndex ? 'bg-white shadow-sm' : 'bg-white/40'
                  }`}
                  onClick={(e) => { e.stopPropagation(); setViewIndex(i) }}
                  title={v.label}
                />
              ))}
            </div>
          )}
          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
            <Eye className="size-5 text-white" />
          </div>
        </div>
        {/* Info */}
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium truncate flex-1">{asset.name}</span>
            <Badge
              variant="outline"
              className={`text-[9px] px-1 py-0 shrink-0 ${colors.text} ${colors.border}`}
            >
              {TYPE_LABELS[asset.type]}
            </Badge>
          </div>
          <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
            {asset.description}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="size-6 p-0"
            onClick={(e) => { e.stopPropagation(); onGenerate(asset) }}
            title="生成图片"
            disabled={generating}
          >
            {generating ? <Loader2 className="size-3 animate-spin" /> : <ImageIcon className="size-3" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="size-6 p-0"
            onClick={(e) => { e.stopPropagation(); onOpen(asset) }}
            title="编辑"
          >
            <Pencil className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="size-6 p-0 text-destructive hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(asset) }}
            title="删除"
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Asset List Item (List View) ───────────────────────────

function AssetListItem({
  asset,
  onOpen,
  onGenerate,
  onDelete,
  generating,
}: {
  asset: UnifiedAsset
  onOpen: (a: UnifiedAsset) => void
  onGenerate: (a: UnifiedAsset) => void
  onDelete: (a: UnifiedAsset) => void
  generating: boolean
}) {
  const colors = TYPE_COLORS[asset.type]
  const Icon = colors.icon

  return (
    <div
      className="flex items-center gap-3 p-2.5 rounded-lg border border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
      onClick={() => onOpen(asset)}
    >
      {/* Thumbnail */}
      <div className="size-12 rounded-md overflow-hidden bg-muted/30 shrink-0">
        {asset.imageUrl ? (
          <img src={asset.imageUrl} alt={asset.name} className="w-full h-full object-cover" />
        ) : (
          <div className={`w-full h-full flex items-center justify-center ${colors.bg}`}>
            <Icon className={`size-4 ${colors.text} opacity-50`} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{asset.name}</span>
          <Badge
            variant="outline"
            className={`text-[9px] px-1 py-0 shrink-0 ${colors.text} ${colors.border}`}
          >
            {TYPE_LABELS[asset.type]}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {asset.description}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="size-7 p-0"
          onClick={(e) => { e.stopPropagation(); onGenerate(asset) }}
          title="生成图片"
          disabled={generating}
        >
          {generating ? <Loader2 className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="size-7 p-0 text-destructive hover:text-destructive"
          onClick={(e) => { e.stopPropagation(); onDelete(asset) }}
          title="删除"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
