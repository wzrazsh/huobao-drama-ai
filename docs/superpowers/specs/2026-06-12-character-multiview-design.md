# 角色多视图设计规范

> 日期: 2026-06-12
> 状态: 草稿

## 问题

当前角色只生成 1 张半身肖像照，缺少全身正/背/侧等关键视图，无法满足角色设计参考和 AI 视频一致性需求。

## 目标

每个角色生成 4 张标准视图：
1. **面部特写** — 正脸，肩膀以上，用于面部识别
2. **全身正面** — 全身立姿正面，展示全套服装
3. **全身背面** — 全身背面，展示服装背面细节
4. **全身侧面** — 全身侧面轮廓

## 技术方案

### 1. MiniMax Adapter 修改

**文件: `src/lib/adapters/image.ts`**

当前适配器将 `referenceImages` 映射为 `image` 字段（旧 API），改为 MiniMax 官方推荐的 `subject_reference` 格式。

```typescript
// 当前 (有 referenceImages 时):
body.image = params.referenceImages  // ❌ 旧字段名

// 改为:
if (params.referenceImages?.length) {
  body.subject_reference = params.referenceImages.map(url => ({
    type: 'character',
    image_file: url,
  }))
}
```

同时增加：
- `seed` 字段透传（相同 seed 可复现相近结果）
- `prompt_optimizer: true`（开启 prompt 自动优化）
- 背面/侧面时增加 `n: 2`（生成多张选优）

MiniMax API 端点: `POST /v1/image_generation`
- 模型: `image-01`
- 响应: `data.image_urls[]`（同步，或有 `task_id` 异步轮询）
- 投票 URL: `GET /v1/image_generation/task/{taskId}`

### 2. 角色多视图生成流程

**文件: `src/app/api/ai/generate-character-image/route.ts`**

#### 新请求参数

```json
{
  "characterId": "xxx",
  "viewLabel": "面部特写 | 全身正面 | 全身背面 | 全身侧面",
  // 可选，不传则为批量生成全部 4 视图
}
```

#### 生成顺序（关键）

第 1 步: 生成**面部特写**（纯 prompt，不依赖参考图）
第 2-N 步: 以面部特写的 `imageUrl` 作为 `subject_reference`，生成其他视图

```
┌─────────────────────────────────────────────┐
│  面部特写 (无参考图)                          │
│  prompt: {appearance}, close-up portrait     │
│       │                                      │
│       ▼ (imageUrl 作为 subject_reference)    │
│  ┌─────────────────────────────────────┐    │
│  │  全身正面  ← reference: 面部特写图   │    │
│  │  全身背面  ← reference: 面部特写图   │    │
│  │  全身侧面  ← reference: 面部特写图   │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

#### 视图 Prompt 策略

每个视图使用结构化 prompt，固定部分 + 视角指令：

```typescript
const VIEW_DEFS = {
  '面部特写': {
    aspectRatio: '1:1',
    promptSuffix: 'close-up portrait, face centered, looking at camera, shoulders visible, facial features detailed, cinematic lighting, shallow depth of field',
    negativePrompt: 'full body, half body, multiple people, blurry face',
  },
  '全身正面': {
    aspectRatio: '3:4',
    promptSuffix: 'full body front view, standing upright, whole outfit visible from head to toe, plain background, feet on ground, hands visible, clothing details sharp',
    negativePrompt: 'close-up, portrait, cropped, sitting',
  },
  '全身背面': {
    aspectRatio: '3:4',
    promptSuffix: 'full body back view, standing, seen from behind, entire back of clothing visible, back of hair visible, plain background',
    negativePrompt: 'close-up, front view, face visible',
  },
  '全身侧面': {
    aspectRatio: '3:4',
    promptSuffix: 'full body side view, profile, standing, entire silhouette visible, side profile clearly shown, plain background',
    negativePrompt: 'close-up, front view, back view',
  },
}
```

#### 存储结构

每视图存为独立的 `CharacterAppearance` 记录：

| 字段 | 值 |
|---|---|
| `label` | `面部特写` / `全身正面` / `全身背面` / `全身侧面` |
| `appearanceIndex` | 0-3 对应上述顺序 |
| `imageUrl` | 该视图的图片 URL |
| `imagePrompt` | 该视图使用的完整 prompt |

`Character.imageUrl` 保留为 **面部特写** 的 URL（作为默认展示图）。

### 3. ai-config.ts 改动

新增方法：

```typescript
// 批量生成全部 4 视图
async generateCharacterViews(characterId: string): Promise<void>

// 重新生成某个视图
async generateCharacterView(characterId: string, viewLabel: string): Promise<string>

// 内部方法 — 生成单张带 prompt 和 reference 的图片
async generateImageView(
  baseAppearance: string,
  viewDef: ViewDef,
  referenceUrl?: string
): Promise<string>
```

`generateCharacterPortrait` 方法保留向后兼容（单张面部特写）。

### 4. UI 改动 (asset-workbench.tsx)

#### 角色卡片增加视图指示点

```
┌──────────────┐
│  ● ○ ○ ○     │  ← 4 个小圆点，高亮当前视图
│    图片区     │
│              │
│  林夕  角色   │
│ 描述文本...   │
│              │
│ [生成][编辑]  │
└──────────────┘
```

点击圆点切换卡片显示图，hover 显示视图名称。

#### 详情对话框 — 4 视图 Tab 切换

```
┌─────────────────────────────┐
│ [面部特写] [全身正面] [全身背面] [全身侧面]│
│  ┌───────────────────────┐  │
│  │      当前视图图片      │  │
│  └───────────────────────┘  │
│  提示词: ${view.imagePrompt}│
│  [重新生成此视图]  [保存]    │
└─────────────────────────────┘
```

- 点击 Tab 切换视图
- "重新生成此视图"按钮只刷新当前视图（调用 `generateCharacterView`）
- 视图图片加载中显示 skeleton

### 5. 视频一致性影响

视频生成端（`video.ts` adapter）目前使用 `Character.imageUrl` 作为角色参考图，迁移后：
- 默认仍使用 `Character.imageUrl`（面部特写）
- 后续视频 Agent API 的 `subject_reference_to_video` 可对接全身正面视图，保持角色身形一致

### 6. 向后兼容

- 已有角色只有 1 张图 → CharacterAppearance 表缺少 3 条记录
- 点击"生成图片"或"重新提取"时走新流程，补齐 4 张
- 旧 `Character.imageUrl` 保留，迁移时写回面部特写 URL

### 7. 错误处理

- 每个视图独立生成，失败不影响其他视图
- UI 显示失败视图的"重试"按钮
- 批量生成有进度显示（当前第 x/4 张）
