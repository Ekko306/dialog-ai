# Implementation Plan: 拓展润色气泡（005-polisher-bubble）

**Branch**: `005-polisher-bubble` | **Date**: 2026-10-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-polisher-bubble/spec.md`

**原型图**: `frontend/docs/mockups/子功能-对话演示气泡-拓展润色场景.jpg`（原则 IV：每一步对照，implement 完成后目视比对）

## Summary

润色分支（语法正确但有更地道表达）的反馈目前是一条纯文本消息，本 feature 把它升级为结构化润色气泡：原句行 + 功能行（文A｜拓展润色｜AI 发音）+ `You can also say: "<润色句>"` + 操作栏（循环跟读｜复制｜收藏｜AI 发音）+ 评分条。技术路径与 003 纠错气泡完全同构：后端在既有反馈消息上透传结构化数据（唯一后端改动），前端新建润色气泡组件并复用 003/004 全部既有能力（翻译状态机、TTS 旁路、跟读面板、音频互斥、评分条）。

## Technical Context

**Language/Version**: TypeScript 5.x（Next.js App Router）+ Python 3.11（LangGraph）

**Primary Dependencies**: 前端 assistant-ui（@assistant-ui/react + @assistant-ui/react-langchain）、lucide-react、Tailwind v4、zustand；后端 LangGraph、langchain-deepseek

**Storage**: 无新增存储；翻译/音频缓存沿用 004/003 会话级 Map，气泡数据沿用 003 会话级 correctionCache 模式

**Testing**: 后端 pytest（uv run pytest）；前端 oxlint + tsc --noEmit + 人工浏览器验收

**Target Platform**: 桌面浏览器（localhost:3000），后端 127.0.0.1:2024

**Project Type**: assistant-ui 脚手架前端 + LangGraph 后端（monorepo 双目录）

**Performance Goals**: 气泡展开/收起为纯本地交互 <100ms；润色数据随消息到达即渲染，无额外请求

**Constraints**: 原则 II 后端最小改动（仅一处透传）；003/004 行为零回归；流式链路 metadata.custom 不可靠需双路径读取（003 已验证教训）

**Scale/Scope**: 1 个后端节点小改 + 1 个新前端组件目录（polisher-bubble）+ 既有组件复用接线

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 状态 | 依据 |
|------|------|------|
| I. assistant-ui 框架规范优先 | PASS | 气泡挂载沿用 003 已验证的 `Thread components.AssistantMessage` 官方扩展点分流模式；useAuiState / useLangChainState 均为框架原语 |
| II. 前端适配后端，后端最小改动 | PASS（一处适配，本文档留档） | 见下方「后端最小适配说明」；润色子图逻辑/拓扑/模型调用零改动 |
| III. 现有数据结构复用 | PASS | 复用 polisher 字典既有字段（original_text/polished_text/explanation/polish_status）；不新建数据结构；音频复用 grammer_tutor TTS 旁路契约 |
| IV. 原型图驱动开发 | PASS | spec/plan/tasks 显式引用原型图路径；implement 后目视比对 |

### 后端最小适配说明（原则 II 留档）

**改动点（唯一）**：[talk_graph.py](file:///d:/langgraphprodaima/dialog-ai/backend/src/talk_agent/talk_graph.py) 的 `polisher_reply_message_node`——在既有 AIMessage 的 `additional_kwargs["metadata"]` 中附带 `polisher_data`（raw_text / polished_text / explanation / polish_status）。

**理由**：润色分支的全部数据后端已产出且已写入 state（polisher 字典），但反馈消息只发纯文本正文，前端无法识别「这是润色分支」也无法取得结构化润色句。这是数据透出问题，不是逻辑问题；与 003 当时的 `correction_data` 透传完全同类（003 已验证该模式可行且键名必须是 `additional_kwargs["metadata"]`，前端 react-langchain 包仅映射该键为 `metadata.custom`）。

**不碰的部分**：polisher_subgraph（polisher_node/tts_node/polisher_service/polisher_tts）、父图拓扑（has_issue_route 分流）、langgraph.json 注册键、LLM 调用与提示词、消息正文文案。

**风险**：接近零——只给现有消息多挂一块元数据，正文不变；前端未接上时后端行为与现状完全一致。

## Project Structure

### Documentation (this feature)

```text
specs/005-polisher-bubble/
├── plan.md              # 本文件
├── research.md          # Phase 0 产出：R1~R6 技术决策
├── data-model.md        # Phase 1 产出：PolisherMessageData 契约与状态机
├── quickstart.md        # Phase 1 产出：手动验收指南
├── contracts/
│   └── polisher-message-contract.md  # Phase 1 产出：透传契约（键名/字段/双路径读取）
└── tasks.md             # Phase 2 产出（/speckit-tasks）
```

### Source Code (repository root)

```text
backend/
├── src/talk_agent/
│   └── talk_graph.py                  # 【唯一改动】polisher_reply_message_node 挂 polisher_data 元数据
└── tests/integration_tests/
    └── test_talk_graph_polisher.py    # 【新增】polisher 分支反馈消息的契约测试（metadata 挂载断言）

frontend/
├── components/polisher-bubble/
│   ├── polisher-bubble.tsx            # 【新增】润色气泡主组件（挂载分流 + 双路径数据读取）
│   ├── polisher-toolbar.tsx           # 【新增】功能行：文A｜拓展润色｜AI 发音
│   ├── polisher-actions.tsx           # 【新增】操作栏：循环跟读｜复制｜收藏｜AI 发音
│   └── polisher-data.ts               # 【新增】类型 + parsePolisherData 守卫 + 会话级缓存
├── components/thread.aui.tsx 相关      # 【小改】AssistantMessage 分流：纠错 → 润色 → 普通
└── components/correction-bubble/      # 【复用不改】use-translation / tts-client / use-tts-button / follow-along-panel
```

**Structure Decision**: 润色气泡独立目录 `polisher-bubble/`（与 `correction-bubble/` 平级对称），共享逻辑通过既有 hooks/lib 复用而非复制；不建独立 store（跟读面板已有 zustand store 可直接复用）。

## Complexity Tracking

> 无 Constitution 违规，无需记录。

## 关键技术决策摘要（详见 research.md）

1. **R1 润色句发音**：复用 grammer_tutor TTS 旁路，`corrections` 传润色伪条目 `{wrong: raw, correct: polished, type: "polish"}`，correct kind 音频即润色句——零后端改动（直调 polisher 子图会重跑 LLM，润色结果可能与气泡显示不一致，弃用）
2. **R2 数据读取双路径**：metadata.custom.polisher_data 直读（非流式/历史回灌）+ `useLangChainState("polisher")` 同源关联（流式主路径，正文含润色句做消息级匹配）+ 按消息 id 会话级缓存——003 已验证模式
3. **R3 挂载分流优先级**：纠错气泡 → 润色气泡 → 普通消息（互斥保证，US1-AC4）
4. **R4 原句发音**：useTtsButton raw kind（corrections 传伪条目不影响 raw 音频）
