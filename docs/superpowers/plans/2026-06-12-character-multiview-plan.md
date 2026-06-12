# 角色多视图生成 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每个角色支持 4 视图（面部特写、全身正面、全身背面、全身侧面），利用 MiniMax `subject_reference` 保持一致性

**Architecture:** MiniMax Adapter 增加 `subject_reference` 支持 → `ai-config.ts` 新增多视图生成方法 → API 路由改为多视图循环 → UI 增加视图切换

**Tech Stack:** Next.js, MiniMax image-01, SQLite, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-06-12-character-multiview-design.md`

---

### Task 1: MiniMax Adapter — subject_reference 支持

**Files:**
- Modify: `src/lib/adapters/image.ts:258-377`

**改动内容:**
- 将 `referenceImages` 从 `image` 字段改为 `subject_reference` 格式
- `subject_reference` 数组结构: `[{ type: 'character', image_file: url }]`
- 保持其他 provider 不受影响（只在 MiniMax 中使用 subject_reference）

- [ ] **Step 1: 修改 buildGenerateRequest**

```typescript
// 在 MiniMaxImageAdapter.buildGenerateRequest 中，替换 referenceImages 逻辑
// 当前 (line 294-296):
if (params.referenceImages?.length) {
  body.image = params.referenceImages
}

// 改为:
if (params.referenceImages?.length) {
  body.subject_reference = params.referenceImages.map(url => ({
    type: 'character',
    image_file: url,
  }))
}
```

- [ ] **Step 2: 验证编译**

Run: `npx next build --no-mangling 2>&1 | tail -5`
Expected: `✓ Compiled successfully`

- [ ] **Step 3: 提交**

```bash
git add src/lib/adapters/image.ts
git commit -m "fix(adapter): MiniMax referenceImages → subject_reference"
```

---

### Task 2: ai-config.ts — 多视图生成方法

**Files:**
- Modify: `src/lib/ai-config.ts`

**改动内容:**
- 新增 `generateCharacterViews(characterId)` — 批量生成全部 4 视图
- 新增 `generateCharacterView(characterId, viewLabel)` — 重新生成单个视图
- 内部方法 `generateImageView(baseDesc, viewDef, referenceUrl?)` — 单次生图调用

**视图定义:**

```typescript
const VIEW_DEFS = {
  '面部特写': {
    aspectRatio: '1:1',
    promptSuffix: 'close-up portrait, face centered, looking at camera, shoulders visible, facial features detailed, cinematic lighting, shallow depth of field',
    negativeSuffix: 'full body, half body, multiple people, blurry face, bad anatomy',
  },
  '全身正面': {
    aspectRatio: '3:4',
    promptSuffix: 'full body front view, standing upright, whole outfit visible from head to toe, plain solid background, feet on ground, hands visible at sides, clothing details sharp, full length portrait',
    negativeSuffix: 'close-up, portrait, cropped, sitting, back view, side view',
  },
  '全身背面': {
    aspectRatio: '3:4',
    promptSuffix: 'full body back view, standing, seen from behind, entire back of clothing visible, back of hair visible, back of shoes visible, plain solid background',
    negativeSuffix: 'close-up, front view, face visible, sitting, side',
  },
  '全身侧面': {
    aspectRatio: '3:4',
    promptSuffix: 'full body side view, standing, profile view, entire silhouette visible, side profile clearly shown, plain solid background',
    negativeSuffix: 'close-up, front view, back view, sitting',
  },
}
```

- [ ] **Step 1: 添加 VIEW_DEFS 常量和新方法**

```typescript
// 在 generateCharacterPortrait 方法之后，添加:

type ViewLabel = '面部特写' | '全身正面' | '全身背面' | '全身侧面'

const VIEW_DEFS: Record<ViewLabel, { aspectRatio: string; promptSuffix: string; negativeSuffix: string }> = {
  '面部特写': { aspectRatio: '1:1', promptSuffix: 'close-up portrait, face centered, looking at camera, shoulders visible, facial features detailed, cinematic lighting, shallow depth of field', negativeSuffix: 'full body, half body, multiple people, blurry face, bad anatomy' },
  '全身正面': { aspectRatio: '3:4', promptSuffix: 'full body front view, standing upright, whole outfit visible from head to toe, plain solid background, feet on ground, hands visible at sides, clothing details sharp, full length portrait', negativeSuffix: 'close-up, portrait, cropped, sitting, back view, side view' },
  '全身背面': { aspectRatio: '3:4', promptSuffix: 'full body back view, standing, seen from behind, entire back of clothing visible, back of hair visible, back of shoes visible, plain solid background', negativeSuffix: 'close-up, front view, face visible, sitting, side' },
  '全身侧面': { aspectRatio: '3:4', promptSuffix: 'full body side view, standing, profile view, entire silhouette visible, side profile clearly shown, plain solid background', negativeSuffix: 'close-up, front view, back view, sitting' },
}

async generateCharacterViews(
  characterId: string,
  style?: string
): Promise<{ label: ViewLabel; imageUrl: string }[]> {
  // 1. 获取角色信息（从 DB）
  // 2. 先生成面部特写（无参考图）
  // 3. 以面部特写为参考图，生成其他 3 视图
  // 4. 每个视图保存到 CharacterAppearance
  // 5. 返回结果数组
  throw new Error('Not implemented')
}

async regenerateCharacterView(
  characterId: string,
  viewLabel: ViewLabel,
  referenceUrl?: string
): Promise<string> {
  // 1. 获取角色信息
  // 2. 用视图定义 + 可选参考图生成
  // 3. 保存到 CharacterAppearance
  // 4. 返回新 imageUrl
  throw new Error('Not implemented')
}
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/ai-config.ts
git commit -m "feat(ai): add generateCharacterViews methods (stub)"
```

---

### Task 3: API 路由 — 多视图生成

**Files:**
- Modify: `src/app/api/ai/generate-character-image/route.ts`

**改动内容:**
- 接收可选参数 `viewLabel`，支持单个视图再生
- 不传 `viewLabel` 时，批量生成全部 4 视图
- 面部特写先生成，其他视图以面部特写为 reference

- [ ] **Step 1: 修改请求处理和验证**

```typescript
const { characterId, style, viewLabel } = await request.json()

// 验证 viewLabel 是否合法
const VALID_VIEWS = ['面部特写', '全身正面', '全身背面', '全身侧面']
if (viewLabel && !VALID_VIEWS.includes(viewLabel)) {
  return NextResponse.json({ error: '无效的视图类型' }, { status: 400 })
}
```

- [ ] **Step 2: 实现多视图循环**

伪代码逻辑，在原有生成逻辑基础上：

```typescript
if (viewLabel) {
  // 单个视图再生
  const result = await generateSingleView(character, viewLabel, style)
  return NextResponse.json(result)
} else {
  // 批量 4 视图
  const results = []
  for (const view of VALID_VIEWS) {
    const referenceUrl = view === '面部特写' ? undefined : results[0]?.imageUrl
    const result = await generateSingleView(character, view, style, referenceUrl)
    results.push(result)
  }
  return NextResponse.json({ views: results })
}
```

`generateSingleView` 逻辑（复用原生成代码，增加视图分支）：
1. 构建含视角指令的 prompt
2. 如果有 referenceUrl，传给 `generateImage` 的 `referenceImages`
3. 保存到 CharacterAppearance（按 viewLabel 匹配，upsert）
4. 更新 Character.imageUrl（面部特写时）

- [ ] **Step 3: 验证编译**

Run: `npx next build --no-mangling 2>&1 | tail -5`
Expected: `✓ Compiled successfully`

- [ ] **Step 4: 提交**

```bash
git add src/app/api/ai/generate-character-image/route.ts
git commit -m "feat(api): multi-view character image generation"
```

---

### Task 4: 前端 API Client — 多视图方法

**Files:**
- Modify: `src/lib/api.ts`

**改动内容:**
- 修改 `api.ai.generateCharacterImage` 支持可选 `viewLabel` 参数
- 新增 `api.ai.generateCharacterViews` 批量方法
- 新增 `api.ai.regenerateCharacterView` 重新生成单视图

- [ ] **Step 1: 添加新方法**

```typescript
// 在 api.ai 命名空间下，修改/添加:

// 当前: generateCharacterImage: (characterId: string, style?: string) => ...
// 改为:
generateCharacterImage: (characterId: string, style?: string, viewLabel?: string) =>
  request<{ imageUrl?: string; views?: Array<{ label: string; imageUrl: string }> }>(
    `/api/ai/generate-character-image`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId, style, viewLabel }),
    }
  ),
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/api.ts
git commit -m "feat(api-client): add multi-view character image methods"
```

---

### Task 5: UI — 角色卡片视图指示器

**Files:**
- Modify: `src/components/asset-workbench.tsx`

**改动内容:**
- AssetCard 组件：增加 4 个视图指示小圆点，点击切换显示图
- 从 CharacterAppearance 取全部视图的 imageUrl

- [ ] **Step 1: 提取角色所有视图**

在 `loadDrama` 或新逻辑中，加载角色时一并查询 `CharacterAppearance`：

```typescript
// 已存在于 loadDrama -> drama 数据中
// 在 UnifiedAsset 中增加 views 字段
interface UnifiedAsset {
  id: string
  name: string
  type: AssetType
  description: string
  imagePrompt: string | null
  imageUrl: string | null
  episodeIds: string
  createdAt: string
  raw: Character | Scene | Prop
  views?: Array<{ label: string; imageUrl: string }>  // 新增
}
```

- [ ] **Step 2: 修改 AssetCard — 视图指示点**

在图像区域右上角或右下角增加视图圆点：

```tsx
// 在 AssetCard 的图像区域，条件渲染（仅角色类型）
{asset.type === 'character' && asset.views && asset.views.length > 1 && (
  <div className="absolute top-1.5 right-1.5 flex gap-1">
    {asset.views.map((v, i) => (
      <button
        key={v.label}
        className={`w-2 h-2 rounded-full transition-colors ${
          i === currentViewIndex ? 'bg-white' : 'bg-white/40'
        }`}
        onClick={(e) => { e.stopPropagation(); setCurrentViewIndex(i) }}
        title={v.label}
      />
    ))}
  </div>
)}
```

卡片状态增加 `currentViewIndex`：

```typescript
const [currentViewIndex, setCurrentViewIndex] = useState(0)
// 卡片显示图从 views 取
const displayUrl = asset.views?.[currentViewIndex]?.imageUrl || asset.imageUrl
```

- [ ] **Step 3: 修改 AssetListItem — 视图指示点**

列表视图同步增加视图切换功能。

- [ ] **Step 4: 验证编译**

Run: `npx next build --no-mangling 2>&1 | tail -5`
Expected: `✓ Compiled successfully`

- [ ] **Step 5: 提交**

```bash
git add src/components/asset-workbench.tsx
git commit -m "feat(ui): character card view switcher"
```

---

### Task 6: UI — 详情对话框视图 Tab

**Files:**
- Modify: `src/components/asset-workbench.tsx`

**改动内容:**
- 角色详情对话框增加视图 Tab 切换
- 每个视图独立显示 imageUrl、imagePrompt
- "重新生成此视图"按钮

- [ ] **Step 1: 详情对话框增加 Tab 栏**

在 `detailAsset` 为角色类型时，对话框顶部显示 Tab：

```tsx
{detailAsset?.type === 'character' && detailAsset.views && (
  <div className="flex gap-1 border-b pb-2 mb-4 overflow-x-auto">
    {detailAsset.views.map((v) => (
      <button
        key={v.label}
        className={`px-3 py-1.5 text-xs rounded-t-md whitespace-nowrap transition-colors ${
          activeView === v.label
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted hover:bg-muted/80'
        }`}
        onClick={() => setActiveView(v.label)}
      >
        {v.label}
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 2: 当前视图展示区**

```tsx
{/* 当前视图 */}
{activeViewDef && (
  <div className="space-y-3">
    <div className="aspect-[3/4] rounded-md overflow-hidden bg-muted/30">
      <img src={activeViewDef.imageUrl} alt={activeViewDef.label} className="w-full h-full object-cover" />
    </div>
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-1">提示词</div>
      <p className="text-xs text-muted-foreground bg-muted/30 rounded-md p-2 max-h-24 overflow-y-auto">
        {activeViewDef.imagePrompt || '暂无提示词'}
      </p>
    </div>
    <Button
      size="sm"
      className="text-xs gap-1"
      onClick={() => handleRegenerateView(detailAsset, activeViewDef.label)}
    >
      <RefreshCw className="size-3" />
      重新生成此视图
    </Button>
  </div>
)}
```

- [ ] **Step 3: handleRegenerateView 方法**

```typescript
const handleRegenerateView = async (asset: UnifiedAsset, viewLabel: string) => {
  if (!selectedDramaId) return
  setLoading(true)
  try {
    await api.ai.generateCharacterImage(asset.id, selectedStyle || undefined, viewLabel)
    toast({ title: `${viewLabel} 已重新生成` })
    await loadDrama()
  } catch (err: any) {
    toast({ title: '生成失败', description: err.message, variant: 'destructive' })
  } finally {
    setLoading(false)
  }
}
```

- [ ] **Step 4: 验证编译**

Run: `npx next build --no-mangling 2>&1 | tail -5`
Expected: `✓ Compiled successfully`

- [ ] **Step 5: 提交**

```bash
git add src/components/asset-workbench.tsx
git commit -m "feat(ui): character view tabs in detail dialog"
```

---

### Task 7: 集成测试验证

**Files:**
- None, just manual testing

- [ ] **Step 1: 重启 dev server 并检查**

Run: `npm run dev`（后台）+ 浏览器打开 `localhost:3000`
检查：进入项目 → 素材管理 → 角色卡片应显示视图切换小圆点

- [ ] **Step 2: 测试生成全部 4 视图**

在详情对话框中点击角色的"生成图片"按钮
检查：API 返回 4 个视图的 imageUrl，CharacterAppearance 表新增 4 条记录

- [ ] **Step 3: 测试单视图重新生成**

在详情对话框中切换到某个视图，点击"重新生成此视图"
检查：仅该视图的 imageUrl 更新，其他视图不变

- [ ] **Step 4: 提交测试结果**

```bash
git add -A && git commit -m "test: verify multi-view character generation"
```

---

### Plan Summary

| Task | 文件 | 改动量 |
|---|---|---|
| 1. MiniMax Adapter | `image.ts` | ~10 行 |
| 2. ai-config.ts 新方法 | `ai-config.ts` | ~80 行 |
| 3. API 路由 | `route.ts` | ~100 行 |
| 4. 前端 API Client | `api.ts` | ~10 行 |
| 5. UI 卡片视图指示器 | `asset-workbench.tsx` | ~60 行 |
| 6. UI 详情对话框 Tab | `asset-workbench.tsx` | ~100 行 |
| 7. 集成验证 | — | 手工测试 |
