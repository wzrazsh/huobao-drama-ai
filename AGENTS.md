# AGENTS.md — AI 助手工作备忘

## 浏览器控制 (Chrome DevTools MCP)

本项目通过 `chrome-devtools` MCP 服务器控制本地 Chrome 浏览器进行 UI 交互。

### 前置条件

- Chrome 必须以 `--remote-debugging-port=9222` 参数启动
- 调试端口 `ws://127.0.0.1:9222` 必须可访问
- 每次使用前需确认 dev server (localhost:3000) 已启动

### 启动流程

1. 确保 dev server 运行：`npm run dev`（后台异步启动）
2. 启动 Chrome（通过 powershell，指定独立 user-data-dir 避免冲突）：
   ```
   powershell -Command "Start-Process 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList '--remote-debugging-port=9222','--no-first-run','--user-data-dir=C:\temp\chrome-debug'"
   ```
3. 确认端口连通：`curl http://127.0.0.1:9222/json/version`
4. 打开页面：`mcp__chrome_devtools_new_page` 工具，url = `http://localhost:3000`

### 可用 MCP 工具

| 工具 | 用途 |
|---|---|
| `mcp__chrome_devtools_new_page` | 打开新标签页 |
| `mcp__chrome_devtools_list_pages` | 列出所有标签页 |
| `mcp__chrome_devtools_navigate_page` | 导航/刷新/前进/后退 |
| `mcp__chrome_devtools_click` | 点击元素（需 uid） |
| `mcp__chrome_devtools_hover` | 悬停元素（需 uid） |
| `mcp__chrome_devtools_close_page` | 关闭标签页 |
| `mcp__chrome_devtools_handle_dialog` | 处理弹窗 |
| `mcp__chrome_devtools_emulate` | 模拟设备/网络/地理位置 |
| `mcp__chrome_devtools_take_snapshot` | 获取页面可访问性快照（含元素 uid） |
| `mcp__chrome_devtools_fill` | 填写表单输入框 |
| `mcp__chrome_devtools_fill_form` | 批量填写多个表单元素 |
| `mcp__chrome_devtools_press_key` | 键盘按键/组合键 |
| `mcp__chrome_devtools_evaluate_script` | 在页面中执行 JS |
| `mcp__chrome_devtools_select_page` | 在多标签页间切换 |
| `mcp__chrome_devtools_upload_file` | 上传文件到页面 |
| `mcp__chrome_devtools_drag` | 拖拽元素 |

### 获取页面内容

1. **`take_snapshot`** → 获取页面可访问性快照，所有交互元素有唯一 `uid`
2. **`click`/`hover` + `includeSnapshot: true`** → 操作后附带快照
3. **`evaluate_script`** → 执行 JS 读取页面数据（获取 cookie 等）
4. **`list_network_requests` / `get_network_request`** → 查看网络请求和 cookie
5. **注意**：每次导航后元素 uid 会变，需重新 `take_snapshot`

---

## MiniMax 适配器配置

### 图片生成

| 项 | 值 |
|---|---|
| 模型 | `image-01` |
| API 端点 | `POST /v1/image_generation` |
| 参考图 | `subject_reference: [{ type: 'character', image_file: url }]` |
| 返回格式 | `data.image_urls[]`（同步）或 `task_id`（异步轮询） |

适配器在 `src/lib/adapters/image.ts` 中实现，当前支持 OpenAI、Gemini、MiniMax、VolcEngine、Ali 五家。

### 视频生成

| 项 | 值 |
|---|---|
| 模型 | `MiniMax-Hailuo-2.3` |
| 默认时长 | 6s |
| 查询路径 | `/v1/query/video_generation?task_id=` |
| 状态值 | `Success` / `success` / `Succeeded` / `succeeded` |
| 返回 | `file_id`（需额外下载） |

### 供应商预设

预设定义在 `src/lib/provider-presets.ts`，baseUrl 统一使用 `api.minimaxi.com`。

支持的模型：MiniMax-M3（LLM）、image-01（图片）、MiniMax-Hailuo-2.3（视频）、speech-2.8-turbo（语音）

---

## 角色多视图功能

每个角色生成 4 张标准视图，利用 MiniMax `subject_reference` 保持角色一致性。

### 视图定义

| 视图 | 比例 | 说明 | 生成顺序 |
|---|---|---|---|
| 面部特写 | 1:1 | 正脸肩膀以上 | 第 1（无参考图） |
| 全身正面 | 3:4 | 全身立姿正面 | 第 2（参考面部特写） |
| 全身背面 | 3:4 | 全身背面 | 第 3（参考面部特写） |
| 全身侧面 | 3:4 | 全身侧面轮廓 | 第 4（参考面部特写） |

### 关键文件

| 文件 | 职责 |
|---|---|
| `src/lib/ai-config.ts` | `VIEW_DEFS` 常量、`generateCharacterPortrait` 等方法 |
| `src/app/api/ai/generate-character-image/route.ts` | 多视图生成 API（viewLabel 参数控制单视图/批量） |
| `src/lib/adapters/image.ts` | MiniMax adapter（subject_reference 格式） |
| `src/components/asset-workbench.tsx` | 素材管理 UI（视图指示圆点 + 详情 Tab） |
| `prisma/schema.prisma` | CharacterAppearance 模型（label, imageUrl, appearanceIndex） |

### 数据存储

```
Character 表
  └── imageUrl → 面部特写 URL（默认展示）

CharacterAppearance 表（每个视图一条记录）
  ├── label: '面部特写' | '全身正面' | '全身背面' | '全身侧面'
  ├── imageUrl: 该视图的图片
  ├── appearanceIndex: 0-3
  └── imagePrompt: 该视图使用的 prompt
```

---

## 设计规范文档

| 文件 | 说明 |
|---|---|
| `docs/superpowers/specs/2026-06-12-character-multiview-design.md` | 角色多视图设计规范（Brainstorming 产出） |
| `docs/superpowers/plans/2026-06-12-character-multiview-plan.md` | 实现计划（Subagent-Driven Development 执行） |

设计方案时遵循 brainstorming 流程：调研 → 询问 → 2-3 方案 → 设计呈现 → 文档 → 用户 review → 实现。

---

## 通用备忘

- 默认管理员账号：`admin@huobao.com` / `admin123`
- Dev server 端口 3000，重启前先 `Stop-Process` 杀掉旧 node 进程
- 系统代理 `127.0.0.1:7897`，推送到 GitHub 时需配置 `http.proxy`
- 本地 SQLite 数据库：`prisma/db/custom.db`
- Prisma 生成客户端命令：`npx prisma generate`
