# Implementation Plan: 自由对话主窗口与三 Tab 主框架

**Branch**: `001-main-tab-shell` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-main-tab-shell/spec.md`

**原型图**: `frontend/docs/mockups/自由对话主窗口_所有其他子功能布局根据这个来-不要参考子功能的布局.png`（本功能唯一视觉基准；后续子功能原型图仅约束其各自功能，不约束本框架布局）

## Summary

将现有单页对话应用（page.tsx → assistant.tsx → Thread）重构为"三 Tab 主框架 + 第一个 Tab 承载自由对话主页面"的结构：

1. **三 Tab 主框架**：底部 TabBar（对话 / 占位 A / 占位 B），仅第一个 Tab 开发主页面，另两个为空占位页；Tab 间切换保持状态（单页面内组件级切换，不走 Next.js 多路由）。
2. **现有对话能力原样迁移**：`useStreamRuntime` 运行时、Thread 消息流、HITL（InterruptPrompt + `useLangChainRespond`）、NewDialogButton / AutoContinue 循环对话流，全部收入第一个 Tab。
3. **真实语音输入**（spec FR-009，Constitution 原则 II 已确认的最小后端修改）：前端实现 assistant-ui 官方 `DictationAdapter` 接口的自定义适配器，单击"点击说话"开始、再单击结束；录音经 Web Audio API 采集为 16kHz/16bit/单声道 raw PCM，POST 到后端新增转写端点（LangGraph Server `http.app` 挂载 FastAPI，内部复用 `xfyun_iat_tool_by_audio_data`）；转写文本自动直接发送，失败时轻提示不断页面。
4. **UI 按原型图优化**：主题色（globals.css oklch 变量）、圆角、输入区样式、顶部栏布局（FR-005/FR-006/FR-010）。

## Technical Context

**Language/Version**: TypeScript 5.x（strict）+ Python >=3.10（后端转写端点）

**Primary Dependencies**:
- 前端：Next.js 16.3.5（App Router，turbopack）、React 19.3、@assistant-ui/react（0.15.x）、@assistant-ui/react-langchain、@langchain/langgraph-sdk 1.11、Tailwind CSS 4.3、zustand 5、lucide-react、@base-ui/react（shadcn base-nova 风格）
- 后端：LangGraph Server（`langgraph dev`，端口 2024）、FastAPI（经 langgraph.json `http.app` 挂载）、xfyunsdkspeech（讯飞 IAT，已有）
- Lint/Format：oxlint + oxfmt（前端）；ruff（后端，已有配置）

**Storage**: 无新增存储。对话状态沿用 LangGraph Server checkpointer；Tab 选中态为前端 React state。

**Testing**: 前端无测试框架（package.json 无 test script）→ 以 [quickstart.md](./quickstart.md) 手动验证为准；后端已有 pytest 可为转写端点补最小单测（复用 `test_resources/iat_pcm_16k.pcm`，可选）。

**Target Platform**: 桌面 + 移动浏览器（语音输入依赖 `getUserMedia`，要求 localhost 或 HTTPS）。

**Project Type**: Web 应用（monorepo：`frontend/` Next.js + `backend/` LangGraph Server）。

**Performance Goals**: 语音停止到转写返回 ≤3s（受讯飞 IAT 服务耗时支配）；Tab 切换即时响应（纯客户端渲染切换）。

**Constraints**:
- 转写端点为 Constitution 原则 II 项下**已确认的最小后端修改**：仅新增一个 FastAPI app 文件 + langgraph.json 一行 `http.app` 配置；禁止改 graph 结构/节点逻辑/状态定义。
- 不修改现有数据结构：对话消息、interrupt 等只做读取展示。
- 浏览器录音格式约束：讯飞 IAT 要求 raw PCM 16kHz/16bit/单声道 → 前端用 Web Audio API 指定 `AudioContext({ sampleRate: 16000 })` 采集并转 Int16，不用 MediaRecorder（避免后端转码依赖 ffmpeg）。

**Scale/Scope**: 单用户本地/内网使用；本功能 3 个用户故事 + 1 个新 HTTP 端点，涉及前端约 8 个文件（4 新增 4 修改）、后端 2 个文件（1 新增 1 修改）。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 结论 | 依据 |
|------|------|------|
| I. assistant-ui 官方规范优先 | ✅ PASS | 语音输入采用官方 `DictationAdapter` 接口 + `ComposerPrimitive.Dictate/StopDictation`（[官方 Dictation 指南](https://www.assistant-ui.com/docs/guides/dictation)）；Tab 框架用普通 React 组件 + Tailwind，不与 assistant-ui 原语冲突；`useStreamRuntime` 的 `adapters.dictation` 为官方文档明确支持的运行时选项。 |
| II. 前端适配后端，最小后端修改 | ✅ PASS（含 1 处留档修改） | 后端新增：`backend/src/webapp.py`（FastAPI，仅 1 个转写端点，内部调用现有 `xfyun_iat_tool_by_audio_data`，不改任何 graph）+ `langgraph.json` 增加 `"http": {"app": "./src/webapp.py:app"}`。此修改在 clarify 阶段经用户确认（spec FR-009），理由：讯飞 IAT 无现成 HTTP 接口，且必须服务端持有 XF 凭据。 |
| III. 现有数据结构复用，读取展示优先 | ✅ PASS | 对话消息、interrupt、工具调用等沿用现有 Thread 渲染（thread.aui.tsx）原样迁移；新增数据仅前端 Tab 配置（纯前端态）与转写请求/响应（见 contracts），不改后端 state。 |
| IV. 原型图驱动开发 | ✅ PASS | 本 plan 已引用主布局原型图路径；Phase 1 的 data-model / contracts / quickstart 均对照该图展开（TabBar 底部三 Tab、顶部栏 FR-005、输入区 FR-006）；tasks 阶段将逐步骤引用；implement 后需目视比对。 |

**Phase 1 复检（设计完成后）**: 4 项均维持 PASS。设计未引入新后端实体、未增加额外后端文件（webapp.py + langgraph.json 即全部后端改动）、UI 方案全部映射到原型图元素。无违宪项，Complexity Tracking 留空。

## Project Structure

### Documentation (this feature)

```text
frontend/specs/001-main-tab-shell/
├── plan.md              # 本文件
├── research.md          # Phase 0 输出：技术决策与依据
├── data-model.md        # Phase 1 输出：实体定义（新增 + 复用）
├── contracts/           # Phase 1 输出：接口契约
│   └── audio-transcribe.md  # 语音转写端点契约
├── quickstart.md        # Phase 1 输出：手动验证指南
└── tasks.md             # Phase 2 输出（/speckit-tasks 生成，本阶段不创建）
```

### Source Code (repository root)

```text
frontend/                            # Next.js 16 App Router（assistant-ui 模板）
├── app/
│   ├── page.tsx                     # 【修改】渲染 <MainTabShell />
│   ├── assistant.tsx                # 【保留，小改】AssistantRuntimeProvider + useStreamRuntime（adapters.dictation 注入）
│   ├── layout.tsx                   # 【保留】字体 / TooltipProvider
│   ├── globals.css                  # 【修改】主题色 oklch 变量、--radius 按原型图调整
│   └── api/[_path]/route.ts        # 【保留】LangGraph 同源边缘代理（转写请求也经此转发）
├── components/
│   ├── main-tab-shell.tsx           # 【新增】三 Tab 主框架（Tab 状态 + 条件渲染，状态保持）
│   ├── tab-bar.tsx                  # 【新增】底部 TabBar（原型图样式：图标 + 文案 + 选中态）
│   ├── main-chat-page.tsx           # 【新增】Tab1 主页面：顶部栏 + Thread + 输入区组合
│   ├── empty-tab.tsx                # 【新增】空占位页（Tab2/Tab3）
│   ├── server-dictation-adapter.ts  # 【新增】自定义 DictationAdapter（Web Audio 采集 16k PCM → POST 转写）
│   ├── thread.aui.tsx               # 【修改】Composer 接入 Dictate/StopDictation + 自动发送 + 样式对齐原型图
│   ├── interrupt-prompt.tsx         # 【保留】HITL 回复（useLangChainRespond）
│   └── talk-flow.tsx                # 【保留】NewDialogButton / AutoContinue
└── docs/mockups/
    └── 自由对话主窗口_所有其他子功能布局根据这个来-不要参考子功能的布局.png

backend/                             # LangGraph Server（langgraph dev → localhost:2024）
├── langgraph.json                   # 【修改】+ "http": { "app": "./src/webapp.py:app" }
├── src/
│   ├── webapp.py                    # 【新增】FastAPI app：POST /audio/transcribe（复用 xfyun_iat_tool_by_audio_data）
│   ├── talk_agent/                  # 【不动】主对话 graph 及全部子图
│   └── tools/audio_tool/xfyun_ita/  # 【不动】xfyun_iat_tool_by_audio_data（转写端点调用它）
└── pyproject.toml                   # 【视需要】显式补 fastapi 依赖声明（langgraph dev 环境已传递提供）
```

**Structure Decision**: 沿用 monorepo 现有 `frontend/` + `backend/` 双目录结构，不新增工程。前端采用**单页面组件级 Tab 切换**（`app/page.tsx` 内 `MainTabShell` 管理 activeTab state）而非 Next.js 多路由：保证切 Tab 时 `AssistantRuntimeProvider` 与 LangGraph 流状态不重挂载（spec FR-003 状态保持），且原型图中三 Tab 同属一个应用壳。后端转写端点经 LangGraph Server `http.app` 挂载（与 graph 同进程同端口），前端通过现有 `/api` 同源代理访问，不新增部署单元。

## Complexity Tracking

> 无 Constitution 违宪项，本节留空。
