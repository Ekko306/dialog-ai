# Research: 自由对话主窗口与三 Tab 主框架

**Branch**: `001-main-tab-shell` | **Date**: 2026-10-21
**原型图**: `frontend/docs/mockups/自由对话主窗口_所有其他子功能布局根据这个来-不要参考子功能的布局.png`

本文件解决 spec 中全部技术未知项。每项给出**决策 / 依据 / 备选方案（含拒绝理由）**。

---

## R1. 语音转写端点如何挂载到后端？

**决策**: 在 `backend/langgraph.json` 增加 `"http": { "app": "./src/webapp.py:app" }`，新增 `backend/src/webapp.py` 定义 FastAPI app，暴露 `POST /audio/transcribe`，内部调用现有 `xfyun_iat_tool_by_audio_data(audio_data)`。

**依据**:
- LangGraph 官方文档（langchain docs MCP 查证，docs.langchain.com/langsmith/custom-routes 与 application-structure）：
  - Python 侧即"创建一个 FastAPI app 文件"，`http.app` 指向 `module:app`；
  - 自定义路由与 LangGraph API **同 host 同端口**（本地 `langgraph dev` 即 `http://localhost:2024`）；
  - 自定义路由优先于内置路由，但应避开 `/threads`、`/runs` 等内置前缀（故选用 `/audio/transcribe`）。
- 后端现状：无自建 FastAPI 服务（langgraph.json 仅 7 个 graphs + env），`xfyun_iat_tool_by_audio_data`（backend/src/tools/audio_tool/xfyun_ita/xfyun_iat_tool.py L112）已实现 PCM→文本，仅缺 HTTP 壳。
- 凭据（XF_APP_ID/XF_API_KEY/XF_API_SECRET）由后端 `.env` 持有（langgraph.json `env=".env"`），浏览器不可接触——转写必须在服务端完成。

**备选方案（拒绝）**:
- ❌ 独立 FastAPI 微服务：新增部署单元、新端口、新 CORS 配置，违反 Constitution 原则 II 最小修改。
- ❌ Next.js API route 直调讯飞：讯飞凭据泄入前端仓库/环境；且前端代理层不应承担业务转写逻辑。
- ❌ 修改 talk_agent graph 增加"转写节点"：改动 graph 结构，明确违反 Constitution 原则 II 禁区。

**FastAPI 可用性**: `langgraph dev` 运行环境（dev 依赖组 `langgraph-cli[inmem]` → langgraph-api）已传递提供 `fastapi`；为显式化，在 `pyproject.toml` dependencies 中补一行 `fastapi`（仅声明，不改版本约束逻辑）。

---

## R2. 前端如何采集符合讯飞 IAT 要求的音频？

**决策**: 自定义 `DictationAdapter`（`server-dictation-adapter.ts`）内部用 **Web Audio API** 采集：
1. `navigator.mediaDevices.getUserMedia({ audio: true })` 取麦克风流；
2. `new AudioContext({ sampleRate: 16000 })` 让浏览器完成重采样（Chrome/Edge/Safari 支持构造参数指定采样率；不支持时回退默认采样率并前端线性重采样）；
3. AudioWorklet（回退 ScriptProcessorNode）收集 Float32 帧 → `Math.max(-1, Math.min(1, sample)) * 0x7FFF` 转 **Int16 PCM**；
4. `stop()` 时把全部 Int16 帧合并为 `ArrayBuffer`，`Content-Type: application/octet-stream` POST 到转写端点；
5. 响应 `{ text }` 作为 `isFinal: true` 的 `DictationAdapter.Result` 发出，session 置 `ended/stopped`。

**依据**:
- 讯飞 IAT 工具函数签名（实测源码）：`xfyun_iat_tool_by_audio_data(audio_data)` 接受 raw PCM 字节，aue="raw"，要求 16kHz/16bit/单声道；dwa="wpgs" 动态修正已内置。
- 浏览器 `AudioContext({ sampleRate })` 构造参数自 Chrome 74+ / Firefox 61+ / Safari 14.1+ 支持，覆盖目标环境（桌面 + 移动现代浏览器）。
- 该模式与 assistant-ui 官方"Server-side transcription"示例（dictation 指南）结构一致：录音 → POST → `{ text }` → `isFinal: true`；区别仅在录音器从 MediaRecorder 换为 Web Audio 直采，且上传体从 multipart 换为 octet-stream（与后端契约对齐）。

**备选方案（拒绝）**:
- ❌ MediaRecorder（官方示例默认）：输出 webm/opus，讯飞 IAT 不接受；后端转码需 ffmpeg（wolfi 镜像额外依赖、延迟增加），违反最小后端修改。
- ❌ Web Speech API（`WebSpeechDictationAdapter`）：Chrome 系将语音送 Google 服务器，国内网络不可用；Safari/Firefox 支持残缺；不符合"后端讯飞转写"的用户决策（clarify Q1→B）。
- ❌ 后端接收 webm 后用 pydub/ffmpeg 转码：同上 ffmpeg 依赖问题。

**约束**: `getUserMedia` 要求 localhost 或 HTTPS——本地开发与当前部署形态均满足；不满足时（如 http 内网 IP 访问）语音按钮置灰并提示，键盘输入不受影响。

---

## R3. 语音输入如何接入 assistant-ui（官方规范）？

**决策**: 走 assistant-ui 官方 **Dictation** 体系（`@assistant-ui/react` 0.15.x，官方指南 `/docs/guides/dictation` 查证）：

1. **适配器注入**：`useStreamRuntime({ ..., adapters: { dictation: new ServerDictationAdapter() } })`。官方 runtime options 表明确列出 `adapters: { attachments?, speech?, dictation?, voice?, feedback? }`。
2. **适配器契约**（官方 `DictationAdapter` 接口，`@assistant-ui/core` 定义、`@assistant-ui/react` re-export）：
   ```ts
   { listen: () => Session; disableInputDuringDictation?: boolean }
   Session: { status: "starting"|"running"|{type:"ended",reason}, stop(): Promise<void>, cancel(): void,
              onSpeechStart/onSpeechEnd/onSpeech: (cb) => Unsubscribe }
   Result: { transcript: string; isFinal?: boolean }
   ```
3. **UI 原语**：`ComposerPrimitive.Dictate`（未录音时）+ `ComposerPrimitive.StopDictation`（录音中），用 `AuiIf condition={(s) => s.composer.dictation == null/!= null}` 切换；转写文本由 runtime 自动 commit 进 composer 输入框。
4. **交互映射**（spec FR-009：单击开始 → 再单击结束 → 自动发送）：
   - 单击 `Dictate` = `listen()`；单击 `StopDictation` = `session.stop()` → 触发上传转写 → final 文本入 composer；
   - `disableInputDuringDictation: false`（录音中允许键盘输入，转写结果为一次性 final，不冲突）。
5. **自动发送**：转写 final 文本 commit 进 composer 后自动触发发送。实现上在 composer 区域监听 dictation 会话结束且 composer 有未发送文本时调用发送（`ComposerPrimitive.Send` 同款 runtime action；运行中线程由 runtime 的 send gating 处理）。失败路径：适配器 emit `ended/error` → composer 无文本 → 不发送，UI 弹轻提示（toast，1~2s 自动消失），页面可继续操作（spec FR-009 兜底 A）。

**依据**: assistant-ui MCP `search_docs` + WebFetch 官方 dictation 指南全文；`useStreamRuntime` options 表（`/docs/runtimes/langchain`）。

**备选方案（拒绝）**:
- ❌ 完全手写录音按钮 + `useAui().thread.append()` 绕过 composer：绕开官方 dictation 状态机（`composer.dictation`），丢失 StopDictation/Transcript 原语与自动停止等内建行为，违反 Constitution 原则 I。

---

## R4. 转写请求从前端到后端的链路？

**决策**: 前端 `fetch("/api/audio/transcribe", { method: "POST", body: pcmBuffer, headers: { "Content-Type": "application/octet-stream" } })` → Next.js 现有边缘代理 `app/api/[_path]/route.ts`（同源校验 + 转发）→ `LANGGRAPH_API_URL/audio/transcribe`（即 `http://localhost:2024/audio/transcribe`）→ webapp.py FastAPI 端点 → `xfyun_iat_tool_by_audio_data`。

**依据**: 代理实测代码（app/api/[_path]/route.ts）转发 GET/POST/…全方法并透传 content-type；LangGraph `http.app` 自定义路由与 API 同 host。**零新增代理配置**。

**备选方案（拒绝）**: ❌ 新建 `app/api/audio/route.ts` 再手写转发：重复既有代理逻辑，违反 DRY 且增加维护面。

---

## R5. 三 Tab 主框架的路由实现方式？

**决策**: **单页面组件级切换**：`app/page.tsx` 渲染 `<MainTabShell />`（client component），内部 `useState<"chat"|"tab2"|"tab3">` 管理激活 Tab；`AssistantRuntimeProvider`（assistant.tsx）包在 shell 外层，切 Tab 仅条件渲染内容区，**不卸载 provider**。

**依据**:
- spec FR-003 要求切 Tab 保持对话状态。`useStreamRuntime` 的流状态/消息缓冲驻留 provider；多路由导航（Next.js App Router）会重挂载 page 级组件树，虽 provider 提升到 layout 可保活，但引入路由级复杂度且与原型图"单一应用壳 + 底部导航"不符。
- 原型图：三 Tab 属同一主窗口布局，Tab2/Tab3 为空页——无深链需求，不需要 URL 语义。

**备选方案（拒绝）**:
- ❌ Next.js 多路由（/chat、/tab2、/tab3）：重挂载丢状态风险、URL 与原型不符、无深链收益。
- ❌ URL query（?tab=2）同步：当前无深链/分享需求，YAGNI；后续子功能若需深链再演进。

**Tab 配置**: 纯前端常量数组 `[{ id, label, icon }]`（lucide-react 图标），文案与图标按原型图；Tab2/Tab3 渲染 `<EmptyTab />`（占位插画 + "功能建设中"文案，静态展示，点击无行为元素按 FR-010 处理）。

---

## R6. UI 主题化方案（圆角 / 主题色 / 输入框）？

**决策**: 全部经 Tailwind 4 + shadcn 变量体系实现，**不改组件结构**：
- **主题色**：`app/globals.css` 的 `@theme inline` 中 `--color-primary` / `--color-ring` 等 oklch 值按原型图主色调整（亮/暗两套 `.dark` 同步）；原型图主色提取在 tasks 拆步时对照图片确认（先按图采样，实现后目视比对微调——Constitution 原则 IV）。
- **圆角**：现有 `--radius: 0.625rem` 及 `--composer-radius: 1rem`（thread.aui.tsx）按原型图气泡/输入框圆角调整。
- **输入区**：`--composer-bg` / `--composer-padding` 变量 + Composer 结构对齐原型图（输入框、左侧功能图标、右侧语音/发送按钮）；语音按钮接入 R3 的 `Dictate/StopDictation`。
- **顶部栏**（FR-005）：主页面顶部静态布局（标题/角色名 + 右侧功能按钮），无子功能支撑的元素按 FR-010 静态展示点击无行为。

**依据**: globals.css（Tailwind 4 `@theme inline` 映射 shadcn oklch 变量）、thread.aui.tsx CSS 变量实测；components.json（style: base-nova，baseColor: zinc）。

**备选方案（拒绝）**: ❌ 引入新 UI 库/硬编码色值：破坏现有 shadcn 变量体系与暗色模式。

---

## R7. 现有"兼容代码"迁移清单（原样保留项）

逐项核对，迁移时**不改行为**：

| 现有代码 | 能力 | 迁移方式 |
|---------|------|---------|
| app/assistant.tsx | `useStreamRuntime` + `AssistantRuntimeProvider`（apiUrl 默认 `/api` 代理） | 保留为 provider 层，包在 MainTabShell 外 |
| components/thread.aui.tsx | 消息流渲染（User/Assistant 气泡、工具调用、Markdown、reasoning）+ Composer | 原样进 Tab1 主页面；仅按原型图调整样式变量与接入语音按钮 |
| components/interrupt-prompt.tsx | HITL：`useLangChainInterruptState` + `useLangChainRespond`（裸字符串 resume） | 原样进 Tab1（常驻 ViewportFooter） |
| components/talk-flow.tsx `NewDialogButton` | 首轮空输入 run 启动新对话 | 原样进 Tab1 |
| components/talk-flow.tsx `AutoContinue` | run 到 END 自动续跑 | 原样进 Tab1 |
| app/api/[_path]/route.ts | LangGraph 同源代理 | 不动，复用为转写请求通道（R4） |

**已确认的实现红线**（talk-flow.tsx 注释留档）：恢复 interrupt 必须用 `respond`；`submit(null, {command:{resume}})` 在当前 SDK/服务端组合下不生效，禁止使用。

**旧入口处置**（clarify Q3→A）：迁移完成、验证通过后，`app/page.tsx` 原单页对话内容移除，由 MainTabShell 取代；无其他路由残留（app/ 下无多余 page）。

---

## R8. 性能与失败兜底要点

- **转写时延**：讯飞 IAT 流式转写通常 1~2s；`stop()` 后 UI 显示"转写中…"态（`DictationTranscript`/按钮 pending 态），返回后自动发送。
- **转写失败**（网络/凭据/讯飞错误）：适配器 `ended/error` → 轻提示 → 不阻塞键盘输入路径。
- **录音中切 Tab**：Tab 切换不卸载 provider，但录音组件若随内容区卸载，session 由适配器 `cancel()` 收尾（停 tracks、置 ended），不产生悬挂录音。
- **空 PCM 防护**：录音时长 <300ms 视为无效，不上传、直接置 ended，避免讯飞报错路径。
