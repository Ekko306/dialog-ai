# Implementation Plan: 子功能-对话演示气泡-语法纠错场景

**Branch**: `003-grammar-correction-bubble` | **Date**: 2026-10-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-grammar-correction-bubble/spec.md`

## Summary

在 Tab1 主页自由对话的 AI 消息流中，将含语法纠错内容的 AI 消息渲染为专用纠错气泡（默认展开态：原句行 + 功能行 + 讲解 + ✅ 正确句 + 操作栏；可收起为紧凑两行），并提供复制正确句、双 AI 发音（走后端 TTS 旁路）、循环跟读面板（倍速/语言/循环/进度控制）、文A 翻译占位、评分条展示。前端以 assistant-ui 消息渲染分支为核心，音频播放引入全局互斥管理器；后端仅做一处最小适配（纠错结构化数据随消息透传），不改动 Agent 图结构与节点逻辑。

## Technical Context

**Language/Version**: TypeScript 5.x（Next.js 16 App Router，React 19）；后端 Python 3.12 + LangGraph（本期仅一处最小适配）

**Primary Dependencies**: `@assistant-ui/react` + `@assistant-ui/react-langgraph`（useStreamRuntime / MessagePrimitive / useLangChainState）、`zustand`（跟读面板/播放器跨组件状态）、`@base-ui/react`（面板原语）、`tailwindcss v4` + `tw-animate-css`（底部滑入动画）、`lucide-react`（图标）；复用 002-scene-select-popup 已验证的组件模式

**Storage**: 无新增持久化；音频为即时合成即播（Blob URL，会话内生命周期）；对话状态仍由 LangGraph checkpointer 管理

**Testing**: 手动验收（quickstart.md 全流程目视比对 + 功能操作）；既有回归（新对话/HITL/选场景/普通消息）

**Target Platform**: 移动端视口优先（原型图为手机比例），桌面端保证可用

**Project Type**: Web 应用（Next.js frontend + LangGraph backend）

**Performance Goals**: 发音按钮点击 → 首次合成等待有加载态（<3s 常规句），二次点击即时出声（Blob 复用）；气泡展开/收起动画不卡顿

**Constraints**: 音频全局互斥（FR-005）；既有功能零回归（FR-013）；后端改动仅限 tutor_reply_message_node 数据透出（Constitution 原则 II 最小适配）

**Scale/Scope**: 单页面内交互增强；1 个新气泡组件族 + 1 个跟读面板 + 1 个全局音频管理器；不动主窗口结构

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 状态 | 依据 |
|---|---|---|
| I. assistant-ui 框架规范优先 | ✅ PASS | 气泡基于 MessagePrimitive 消息渲染分支实现，状态读取用 react-langgraph 官方 hooks；不绕过 runtime 自造消息流 |
| II. 前端适配后端，后端逻辑最小改动 | ✅ PASS（含一处已记录的最小适配） | 后端仅 tutor_reply_message_node 追加结构化数据透出（不新增端点、不改 graph 拓扑/节点逻辑），理由见下「后端最小适配说明」；其余全部前端适配 |
| III. 现有数据结构复用 | ✅ PASS | 直接复用 OverAllState 既有契约字段（corrections/tutor_reply/ise_grade/raw_audio/tutor_audio），无新数据结构 |
| IV. 原型图驱动开发 | ✅ PASS | spec 引用三张验收基准（展开态 mockup、收起态外部截图、跟读面板外部图以文字描述为基准）；implement 后逐图目视比对 |

**后端最小适配说明**（原则 II 要求留档）：
`talk_graph.py → tutor_reply_message_node` 目前仅把 `tutor_reply` 纯文本写入 messages，前端无法按**每条历史消息**关联纠错结构化数据（corrections/原句/评分）——LangGraph state 是全局值，刷新或多条历史纠错气泡时无法可靠对应。故在该节点构造 AIMessage 时将纠错数据写入 `additional_kwargs.correction_data`（纯透传，不改 LLM 调用、不改图结构、不改其他节点）。拒绝的替代方案：仅用全局 state 匹配最后一条消息（历史消息与刷新场景失效）；前端单独再 invoke 查询 state（多一次往返且同样无法回溯历史消息）。

## Project Structure

### Documentation (this feature)

```text
specs/003-grammar-correction-bubble/
├── plan.md              # This file
├── research.md          # Phase 0: R1-R7 技术决策
├── data-model.md        # Phase 1: 前端数据实体与状态机
├── quickstart.md        # Phase 1: 手动验收指南
├── contracts/
│   ├── correction-message-contract.md  # 纠错消息数据契约（后端透出 ↔ 前端读取）
│   └── tts-bypass-contract.md          # TTS 旁路调用契约（前端 invoke ↔ 后端合成）
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
backend/                                   # 本期仅一处最小适配
└── src/talk_agent/
    └── talk_graph.py                      # tutor_reply_message_node: additional_kwargs 透传（唯一后端改动）

frontend/
├── app/
│   ├── assistant.tsx                      # 既有 provider 层（不动或仅微调）
│   └── api/[..._path]/route.ts            # 既有代理（不动）
├── components/
│   ├── main-chat-page.tsx                 # 消息渲染分支挂载点（纠错气泡 vs 普通气泡）
│   └── correction-bubble/                 # 新增：纠错气泡组件族
│       ├── correction-bubble.tsx          # 气泡骨架（展开/收起两态）
│       ├── correction-toolbar.tsx         # 功能行（文A / ‼语法纠错 / AI 发音）
│       ├── correction-actions.tsx         # 操作栏（循环跟读/复制/收藏/AI 发音）
│       └── score-bar.tsx                  # 评分条（语法/发音/地道，数据缺失不展示）
├── components/follow-along-panel/         # 新增：循环跟读面板
│   └── follow-along-panel.tsx             # 底部滑入面板（进度/倍速/语言/循环/麦克风占位）
└── lib/
    ├── audio-manager.ts                   # 新增：全局音频管理器（单例互斥/倍速/循环/进度事件）
    └── tts-client.ts                      # 新增：TTS 旁路客户端（invoke + base64→Blob）
```

**Structure Decision**: 沿用既有 frontend/（Next.js App Router + assistant-ui）与 backend/（LangGraph）单仓结构；新增代码收敛在 `components/correction-bubble/`、`components/follow-along-panel/`、`lib/audio-manager.ts`、`lib/tts-client.ts` 四处，便于 converge 验收与零回归检查。

## Complexity Tracking

> Constitution Check 无未决违规；后端最小适配已按原则 II 在上方留档，不构成架构复杂度违规。
