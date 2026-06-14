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
## LTX-2.3 MSR 视频生成工作流

### 概述
项目使用 liconstudio 的 **MSR (Multiple Subject Reference) LoRA** + LTX-2.3-22B 模型生成多角色一致性视频。
核心思路：用 4 张演员参考图 + 1 张场景图 → 生成同一角色在视频中**不漂移**的多镜头片段。

### 已部署的 ComfyUI 实例

| 项 | 值 |
|---|---|
| **服务地址** | `https://7af418c0a17c4ebe8a43e16edbbbfe97.region2.waas.aigate.cc` |
| **服务器** | aigate 云端 GPU (4090-24GB, ¥1.78/h) |
| **ComfyUI 路径** | `/root/comfyui/ComfyUI/` |
| **SSH 端口** | `40769` |
| **公网反代 URL** | `https://0b7978c8e1bb4c319157cd51e0472665.region2.waas.aigate.cc` |
| **登录密码** | `138fe785e788492c862c6a100fe2ecdb` |

### 工作流来源

| 仓库 | 用途 |
|---|---|
| https://github.com/liconstudio/ComfyUI-Licon-MSR | LiconMSR 自定义节点 + V1/V2 工作流 |
| https://github.com/liconstudio/LTX2-trainer-kit-windows | LoRA 训练工具（IC-LoRA 模式）|
| https://huggingface.co/LiconStudio/LTX-2.3-Multiple-Subject-Reference | MSR LoRA V1 (624MB) |

### 已部署的自定义节点

| 节点 | 路径 | 作用 |
|---|---|---|
| `ComfyUI-Licon-MSR` | `/root/comfyui/ComfyUI/custom_nodes/ComfyUI-Licon-MSR/` | 多张参考图 → 41 帧参考视频 |
| `ComfyUI-PromptRelay` | `/root/comfyui/ComfyUI/custom_nodes/ComfyUI-PromptRelay/` | `PromptRelayEncode` 节点（V2 用）|
| `ComfyUI-WanVideoWrapper` | (kijai 出品) | LTXVAddGuideMulti、LTXVConditioning 等 |

### 关键模型路径

| 模型 | 路径 |
|---|---|
| 主模型 (蒸馏) | `/root/comfyui/ComfyUI/models/checkpoints/ltx-2.3-22b-distilled-1.1.safetensors` |
| 文本编码器 | `/root/comfyui/ComfyUI/models/text_encoders/gemma_3_12B_it_fp8_e4m3fn.safetensors` |
| **MSR LoRA (核心)** | `/root/comfyui/ComfyUI/models/loras/LTX-2.3-Licon-MSR-V1.safetensors` (624MB) |
| 蒸馏 LoRA | `ltx-2.3-22b-distilled-lora-384-1.1.safetensors` |
### 与 LTX-2.3 MSR 工作流的关联

角色多视图生成后，可以直接作为 **MSR 工作流的演员参考图**：
- 面部特写（`面部特写_*.png`）→ actor1.jpg / actor2.jpg（最佳）
- 全身正面 / 侧面（`全身正面_*.png`）→ 备用参考图

实施时把 `data/uploads/dramas/<dramaId>/characters/` 下的图片
重命名并上传到 ComfyUI input 目录即可。

### 本地工作流备份

所有备份在 `E:/workspace/huobao-drama-ai/.zscripts/`:

| 文件 | 格式 | 用途 |
|---|---|---|
| `comfyui_ltx23_msr_10s_api.json` ⭐ | API | **当前活跃工作流 (10秒版, 中文剧本)** |
| `comfyui_ltx23_msr_v1_api_story.json` | API | 5秒版（早期）|
| `comfyui_ltx23_msr_v1_4090.json` | UI 画布 | 可拖入 ComfyUI 画布 |
| `comfyui_ltx23_msr_4090.json` | UI 画布 | V2 改编版（含 PromptRelayEncode）|
| `comfyui_ltx23_msr_api_4090.json` | API | V2 API 格式 |
| `comfyui_ltx23_msr_v1_api_v3.json` | API | 5秒版第3次迭代 |
| `comfyui_full_4090.json` | API | Wan 2.2 I2V 方案 A/B 用 |
| `comfyui_ltx23_workflow.json` | UI | LTX IC-LoRA 上分工作流 |
| `install_msr_on_server.sh` | Bash | 云端一键安装脚本 |
| `parse_lora.py` / `parse_lora2.py` | Python | LoRA 内部结构分析 |
| `backup/2026-06-13_msr_10s_workflow_backup.md` | Markdown | 完整备份文档 |
| `github_workflows/` | 目录 | 4 个开源工作流原始 JSON |
| `loras/` | 目录 | 备份的 LoRA 文件 |

### 服务器 input 目录

`/root/comfyui/ComfyUI/input/` 下的关键文件：

| 文件 | 用途 |
|---|---|
| `actor1.jpg` | 演员 1 面部特写（短发女主 - 林夕）|
| `actor2.jpg` | 演员 2 面部特写（戴眼镜男主 - 陆辰）|
| `actor3.jpg` | 演员 3 面部特写（戴帽男主）|
| `actor4.jpg` | 演员 4 面部特写（长发盘起女主）|
| `huangpu_river_dusk.jpg` | 黄浦江边背景图（1280×720 JPEG）|
| `comfyui_ltx23_msr_10s_api.json` | 上传的 10秒版工作流 |

### 已生成的视频成果

项目 `data/uploads/dramas/cmqahvjvx0001hnm0cx6zpc1j/scenes/` 下的所有测试视频：

| 文件名 | 时长 | 大小 | 描述 |
|---|---|---|---|
| `huangpu_river_dusk_video_WanVideo2_2_I2V_00001.mp4` | 5.06s | 580KB | 方案 A：Wan 2.2 + LoRA 蒸馏 6步 |
| `huangpu_river_dusk_video_planB_WanVideo2_2_I2V_00002.mp4` | 5.06s | 1.24MB | 方案 B：Wan 2.2 无 LoRA 30步 ⭐ |
| `huangpu_river_dusk_video_UPSCALED_LTX-2_00001.mp4` | 5.71s | 2.07MB | LTX IC-LoRA 上分 1120×1120 |
| `huangpu_river_dusk_video_MSR_huangpu_river_msr_00001_.mp4` | 5.71s | 1.08MB | MSR 简化版英文 prompt |
| `huangpu_river_dusk_video_MSR_STORY_..._luchen_linxi_00001_.mp4` | 5.71s | 1.37MB | MSR 中文剧本版 ⭐ |
| `huangpu_river_dusk_video_MSR_STORY_10S_..._10s_00001_.mp4` | 9.38s | 2.35MB | MSR 中文剧本 10秒版 ⭐⭐ |

### 工作流参数参考

**MSR 10秒版关键参数**（`.zscripts/comfyui_ltx23_msr_10s_api.json`）:

| 节点 | 参数 | 值 |
|---|---|---|
| `[5] CLIPTextEncode` (positive) | text | 中文剧本 (1414 字符) |
| `[6] CLIPTextEncode` (negative) | text | 194 字符负提示词 |
| `[8] EmptyLTXVLatentVideo` | length | **240** 帧 = 10 秒 |
| `[22] LTXVEmptyLatentAudio` | frames_number | 240 |
| `[15] RandomNoise` | noise_seed | 71382195 |
| `[20] SaveVideo` | filename_prefix | `huangpu_river_msr_luchen_linxi_10s` |
| `[28] LiconMSR` | frame_count | 41（参考视频帧数）|
| `[10] LTXICLoRALoaderModelOnly` | lora_name + strength | `LTX-2.3-Licon-MSR-V1.safetensors` + 1.0 |
| `[35] LTXVAddGuideMulti` | num_guides | 5（5 个参考图）|

### 重启后恢复流程

```bash
# 1. SSH 登录
ssh -p 40769 root@0b7978c8e1bb4c319157cd51e0472665.region2.waas.aigate.cc

# 2. 启动 ComfyUI（节点和模型已永久保留）
cd /root/comfyui/ComfyUI && nohup /root/miniconda3/bin/python main.py \
  --preview-method auto --port 8188 --listen 0.0.0.0 --enable-cors-header '*' \
  > /tmp/comfyui.log 2>&1 & disown

# 3. 上传 5 张图到 input 目录（如果丢了）
# 4. 上传 .zscripts/comfyui_ltx23_msr_10s_api.json 到 input
# 5. 在 ComfyUI 界面 Load 该 JSON 即可
```

### ComfyUI API 接口速查

| 端点 | 用途 |
|---|---|
| `GET /system_stats` | GPU 状态 |
| `GET /queue` | 当前队列 |
| `POST /prompt` | 提交任务（body: `{"prompt": {...}, "client_id": "..."}`）|
| `GET /history/{prompt_id}` | 查任务结果 |
| `GET /view?filename=...&type=output&format=video/h264-mp4` | 下载视频 |
| `POST /upload/image` | 上传文件（multipart, key 必须是 `image`）|
| `POST /interrupt` | 中断当前任务 |

### CORS 限制

ComfyUI 服务器在 cloudflare 反代后面，**localhost:3000 不能直接 fetch 它的 API**。需要：
- 用 `requests` (Python) 跨域调用 ✅
- 用 `mcp__chrome_devtools_evaluate_script` 在 ComfyUI 页面 fetch ✅
- 用浏览器直接 fetch ComfyUI API（反代已配 `Access-Control-Allow-Origin: *`）✅

### LoRA 训练备注

MSR LoRA 是用 **IC-LoRA 模式**训练的（不是普通 T2V LoRA），核心：
- 用 200+ 对"参考视频→目标视频"成对数据
- LoRA rank=64, alpha=64
- 目标模块：attn1/attn2 全套 + ff（10 个模块）
- 48 个 transformer block 全部覆盖
- 训练配置见 `liconstudio/LTX2-trainer-kit-windows/configs/ltx2_v2v_ic_lora.yaml`

如果要为本项目 4 个角色训练专属 LoRA：
1. 准备 200+ 段演员视频（含参考-目标对）
2. 用 `process_videos.py` 预处理
3. 改 `configs/ltx2_v2v_ic_lora.yaml`
4. 跑 `train.py`
5. 4090 大约 6 小时，6000D-84G 约 2 小时

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
- **ComfyUI 服务器持续扣费（¥1.78/h），不用时记得关闭实例**
- **MSR LoRA 文件较大（624MB），重新部署需要 5-10 分钟下载**
- **要重做 MSR 工作流调试时，先改本地 `.zscripts/comfyui_ltx23_msr_10s_api.json` 再上传到服务器**
- **如果 ComfyUI 出现节点 missing，重启 ComfyUI 即可（自定义节点 git clone 已永久保留）**
- **要新增备份参考图，命名规则固定为 `actor1.jpg ~ actor4.jpg` + `huangpu_river_dusk.jpg`**
