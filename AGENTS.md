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
| `mcp__chrome_devtools_upload_file` | 上传文件到页面 |
| `mcp__chrome_devtools_drag` | 拖拽元素 |

### 获取页面内容

MCP 工具自身不提供"读取页面文本"的直接方法。获取页面内容的策略：

1. **通过 `includeSnapshot` 参数**：`click`/`hover` 操作时设置 `includeSnapshot: true`，响应中包含当前页面可访问性快照（含元素 uid、role、name 等）
2. **先获取 uid**：快照中每个交互元素有唯一 `uid`，后续 `click`/`hover` 基于 uid 操作
3. **配合 `browser` 工具**：当需要执行 JS (`evaluate`) 读取页面数据时，用 `browser` 工具 `open` 到同个 CDP 端口 (`app: { cdp_url: "http://127.0.0.1:9222" }`)，执行完 JS 后获取结果 — 点击等交互仍优先用 MCP 工具

### 注意

- 页面打开后需 `take_snapshot`（系统自动触发）才能获取元素 uid
- Chrome 进程不能重复启动 — 先 `Stop-Process -Name chrome -Force` 杀掉旧进程再重启
- 每次用 `navigate_page` 导航后元素 uid 会变，需重新获取快照
- 默认管理员账号：`admin@huobao.com` / `admin123`
- Dev server 端口 3000，如需重启先 `Stop-Process` 杀掉旧 node 进程
