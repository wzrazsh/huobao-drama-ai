# 多人对白 Storyboard 设计规范

> 日期: 2026-06-14
> 状态: Approved
> 关联问题: 第一章 #11 "初识对话" — 两个角色对话（陆辰 + 林夕），现有 Storyboard 只能存一个 voiceId

## 背景

当前 `Storyboard.dialogue` 和 `Storyboard.dialogueChar` 是**单角色**字段。
一个 Storyboard = 一个 `ttsAudioUrl`。
这无法表达像"陆辰/林夕：'你是新搬来的？/ 对，楼上，画画的。'"这种双人对白。

如果强行用 `/` 分隔塞到 `dialogue`，TTS 只能用同一个 voiceId 读两个人，破戏。

## 设计

### 1. 数据模型

在 `Storyboard` 表上新增一个**可选**字段：

```prisma
model Storyboard {
  // ... 现有字段 ...
  ttsSegments String?  // JSON: DialogueSegment[]，为空时走单 voiceId 老路径
}

interface DialogueSegment {
  speaker: string            // 角色名（用于查 Character.voiceId）
  text: string               // 这一句对白
  voiceId: string            // 解析后的 voiceId（冗余存，避免重复查表）
  voiceName: string          // 展示用（如 "精英青年V2"）
  audioUrl?: string          // 这段的 TTS 文件 URL（拼到 ttsAudioUrl 之前先存这里）
  startMs?: number           // 在拼接音频中的开始时间（拼接后回填）
  endMs?: number             // 在拼接音频中的结束时间
  status: 'pending' | 'processing' | 'completed' | 'failed'
}
```

**约束**：
- `ttsSegments` 字段是 **opt-in** —— 没设就走原 `dialogue + dialogueChar` 老路径
- `ttsSegments` 存在时，`ttsAudioUrl` 是所有 segment.audioUrl **拼接后**的音频
- `dialogue` 和 `dialogueChar` 仍保留，但 `ttsSegments` 存在时它们只用于展示（`dialogue` 显示为全部段拼接）

### 2. 配音生成流程

**单段路径（现有，向后兼容）**：

```
POST /api/ai/generate-tts { storyboardId, text?, voiceId? }
  → 读 storyboard.dialogue + dialogueChar 解析 voiceId
  → 一次 TTS 调用 → 存 ttsAudioUrl
  → 字幕用 SRT 一段
```

**多段路径（新增）**：

```
POST /api/ai/generate-tts { storyboardId, segments: [{speaker, text, voiceId?}, ...] }
  → 对每段：
       解析 voiceId（按 speaker 查 Character，或用传进来的）
       调 TTS adapter
       存到 seg.audioUrl（FileStorage，按 segment 单独存）
  → 调用 ffmpeg concat filter 把所有 seg.audioUrl 拼成一个 mp3
  → 存到 storyboard.ttsAudioUrl
  → 把 ttsSegments 整段 JSON 存到 storyboard.ttsSegments（每段含 audioUrl + startMs + endMs）
  → 字幕用 SRT 多段（每段 1 个 subtitle entry）
```

ffmpeg 命令：
```bash
ffmpeg -y \
  -i seg1.mp3 -i seg2.mp3 -i seg3.mp3 \
  -filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]" \
  -map "[out]" -c:a libmp3lame -q:a 2 \
  output.mp3
```

### 3. UI 改造

#### 配音面板 (`dubbing-panel.tsx`)

当 `sb.ttsSegments` 存在时：
- 显示"分 N 段"角标
- 每段独立 audio player + 单段重生成按钮
- "批量生成"按钮按段循环
- 总览进度：`已完成段数/总段数`

#### 字幕 (`compose-panel.tsx` / `production-panel.tsx`)

- 当 `ttsSegments` 存在时，从 `ttsSegments[].text` 拼成完整 dialogue 显示
- 视频合成用 SRT 多段（按 `startMs` / `endMs`）

#### 时间线 (`timeline-editor.tsx`)

- 把多段对白显示为"陆辰: ... → 林夕: ..."

### 4. 数据迁移

**新数据**：分镜生成 agent 看到 dialogueChar 含 `/` 时，应该主动拆成 `ttsSegments`。

**老数据**：保持原状（单 voiceId 老路径），不强制 backfill。

**#11 修复**：作为示例，手动重写 #11 的数据：
```json
{
  "dialogue": "你是新搬来的？对，楼上，画画的。",   // 展示用
  "dialogueChar": "陆辰/林夕",                        // 旧字段（不删）
  "ttsSegments": [
    { "speaker": "陆辰", "text": "你是新搬来的？", "voiceId": "male-qn-jingying-jingpin", "voiceName": "精英青年V2", "status": "pending" },
    { "speaker": "林夕", "text": "对，楼上，画画的。", "voiceId": "female-tianmei-jingpin", "voiceName": "甜美女性V2", "status": "pending" }
  ]
}
```

### 5. 错误处理

- 单段 TTS 失败：把那个 segment 的 status 设为 `failed` 继续拼其他段，UI 上显示"3 段中 1 段失败"
- ffmpeg 拼接失败：删除已生成的 segment 文件，ttsSegments 全置 `pending`，抛出 500
- 字符 voiceId 不存在：直接抛 `TTSAdapterError`（沿用 `assign_voice` 的探针缓存机制）

## 涉及文件清单

| 文件 | 改动 |
|---|---|
| `prisma/schema.prisma` | 加 `ttsSegments String?` 字段 |
| `prisma/migrations/20260614_add_tts_segments/migration.sql` | 新迁移 |
| `src/app/api/migrate/route.ts` | 加 `ttsSegments` 字段白名单 |
| `src/app/api/ai/generate-tts/route.ts` | 支持 `segments` 参数；多段路径 |
| `src/lib/ffmpeg.ts` | 加 `concatAudioSegments(segPaths: string[]): Promise<string>` |
| `src/lib/file-storage.ts` | 加 `saveAudioFromDataUrl` helper（如已有则复用） |
| `src/lib/api.ts` | `generateTts` 接受 `segments` |
| `src/components/episode/dubbing-panel.tsx` | 多段显示 + 单段操作 |
| `src/components/episode-workspace.tsx` | `handleGenerateTts` / `handleGenerateAllTts` 支持 segments |
| `src/components/episode/compose-panel.tsx` | 字幕展示用 ttsSegments |
| `src/components/episode/production-panel.tsx` | 同上 |
| `scripts/fix-storyboard-11.ts` | 重写 #11 数据（一次性脚本） |

## 验收

- [ ] Prisma migration 在 dev/custom.db 跑通
- [ ] `POST /api/ai/generate-tts` 单段路径**完全向后兼容**（不传 segments 时行为不变）
- [ ] `POST /api/ai/generate-tts` 传 2 个 segment 时生成 2 段 TTS + 1 个拼接后的 ttsAudioUrl
- [ ] #11 显示"分 2 段"，UI 上能听陆辰（低男声）+ 林夕（女声）两个独立音频
- [ ] 拼接后 ttsAudioUrl 播放顺序正确（陆辰→林夕）
- [ ] 字幕 SRT 多段，对齐到 audio 时间戳
- [ ] 现有 7 条单人对白（#4/9/12/13/14/15/20）不受影响
- [ ] 端到端：UI 触发"生成 #11 配音" → 2 段 TTS 调通 → ffmpeg 拼好 → 数据库字段全填 → 播放听效果
