# Implementation Plan: 纠错气泡原句翻译（文A）

**Branch**: `004-correction-translation` | **Date**: 2026-10-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-correction-translation/spec.md`

## Summary

补齐纠错气泡「文A」按钮的真实翻译能力：点击后在气泡展开区（功能行之下、纠错讲解之上，spec Assumptions 第 6 条布局）展示原句的中文译文。后端在 grammer_tutor 子图内照搬 003 已验证的 TTS 旁路模式新增按需翻译旁路（`translate_request` 入口 → translate_node 单次 LLM 调用），不改动父图拓扑与既有节点；前端新增翻译客户端（复用无状态 `/runs/wait` 直调子图模式）与会话内译文缓存，并把翻译区从当前「讲解之后」的位置调整到截图指定的「讲解之前」。全程按需请求、失败轻提示、重复查看零请求。

## Technical Context

**Language/Version**: TypeScript 5.x（Next.js 16 App Router，React 19）；后端 Python 3.12 + LangGraph（一处最小旁路扩展）

**Primary Dependencies**: 复用 003 全部既有依赖——`@assistant-ui/react` + `@assistant-ui/react-langgraph`（消息渲染与 state hooks，本期不新增用法）、`zustand`、`tailwindcss v4`；后端复用 `langchain_deepchat.ChatDeepSeek`（翻译 LLM 调用）与 grammer_tutor 子图既有双入口拓扑

**Storage**: 无新增持久化；译文在前端会话内 Map 缓存（同 tts-client 的 blobUrlCache 模式），不跨会话保留；对话状态仍由 LangGraph checkpointer 管理

**Testing**: 后端 pytest（translate_node 单测 + 子图旁路集成测试）；前端 oxlint + tsc + quickstart.md 手动验收；003 全量场景回归

**Target Platform**: 移动端视口优先（同 003），桌面端保证可用

**Performance Goals**: 点击「文A」→ 译文呈现 <5s（SC-001，DeepSeek 单句翻译常规 1~3s）；已缓存译文重复展开即时显示（SC-003）

**Constraints**: 按需请求不透传（FR-004）；翻译失败不阻塞气泡其他功能（FR-006/FR-003）；后端改动仅限 grammer_tutor 子图新增旁路节点（Constitution 原则 II 最小适配，见下方留档）；翻译区位置以 spec Assumptions 第 6 条文字描述为验收基准

**Scale/Scope**: 后端 1 个新节点 + 入口路由扩展；前端 1 个新客户端文件 + 1 个新 hook + 气泡组件内翻译区位置调整；不动主窗口、不动音频链路

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 状态 | 依据 |
|---|---|---|
| I. assistant-ui 框架规范优先 | ✅ PASS | 翻译区在既有 CorrectionBubble 组件内扩展，不新增消息流原语、不绕过 runtime；数据获取走与 TTS 相同的 `/runs/wait` 模式（003 已验证并评审通过） |
| II. 前端适配后端，后端逻辑最小改动 | ✅ PASS（含一处已记录的最小适配） | 后端仅 grammer_tutor 子图新增 translate 旁路（新节点 + START 条件边分支），不新增端点、不改父图拓扑、不改任何既有节点逻辑；理由见下「后端最小适配说明」 |
| III. 现有数据结构复用 | ✅ PASS | 请求复用 raw_text 既有字段；translation 为子图私有局部字段（TutorState，不进全局 state.py，同 tts_request 先例）；前端复用 CorrectionMessageData 既有透传结构 |
| IV. 原型图驱动开发 | ✅ PASS | 翻译位置布局以 spec Assumptions 第 6 条文字描述为基准（用户参照截图按其决定不入库）；气泡整体布局对照已入库 `frontend/docs/mockups/子功能-对话演示气泡-语法纠错场景.jpg`；implement 后逐项目视比对 |

**后端最小适配说明**（原则 II 要求留档）：
「文A」译文当前为 003 遗留占位（research.md R4：后端无译文字段）。真实翻译的数据获取有三条路线：① 随纠错消息透传（每轮纠错都多付翻译 token，用户从不点「文A」也付费，且加重复 LLM 调用拖慢纠错主链）；② 前端直调第三方翻译 API（003 research.md R4 已否决：引入新外部依赖、API key 暴露前端）；③ **按需旁路（采纳）**——grammer_tutor 子图已具备「单图双入口懒加载」结构（`route_entry` 按 `tts_request` 分流，003 评审通过的同款模式），翻译旁路完全照搬：`translate_request: true` 时直达 translate_node（单次 ChatDeepSeek 纯文本调用），出参写 `translation` 局部字段，前端经无状态 `/runs/wait` 直调子图读取。改动为「新增一个节点 + 条件边加一个分支」，与 TTS 旁路同构，不改任何既有节点逻辑、不改父图、不改 langgraph.json 注册。translation 与 translate_request 均声明在子图局部 TutorState，不污染全局 state.py 契约（项目约定：子图私有字段本地声明）。

## Project Structure

### Documentation (this feature)

```text
specs/004-correction-translation/
├── plan.md              # This file
├── research.md          # Phase 0: R1-R6 技术决策
├── data-model.md        # Phase 1: 翻译状态机与字段契约
├── quickstart.md        # Phase 1: 手动验收指南
├── contracts/
│   └── translation-bypass-contract.md  # 翻译旁路调用契约（前端 invoke ↔ 后端翻译）
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
backend/                                   # 本期仅 grammer_tutor 子图一处旁路扩展
└── src/talk_agent/subgraphs/grammar_tutor_subgraph/
    └── grammar_tutor_subgraph.py          # translate_node 新节点 + route_entry 加分支 + 拓扑接线（唯一后端改动）

frontend/
├── components/correction-bubble/
│   ├── correction-bubble.tsx              # 翻译区位置调整（讲解前）+ 接入 useTranslation
│   └── use-translation.ts                 # 新增：译文加载/缓存/失败重试 hook
└── lib/
    └── translation-client.ts              # 新增：翻译旁路客户端（invoke + 会话内缓存）
```

**Structure Decision**: 沿用既有 frontend/ 与 backend/ 单仓结构；后端改动收敛在 grammar_tutor_subgraph.py 单文件，前端新增代码收敛在 `lib/translation-client.ts` 与 `components/correction-bubble/use-translation.ts` 两处，气泡组件仅做翻译区移植与 hook 接线，便于 converge 验收与 003 零回归检查。

## Complexity Tracking

> Constitution Check 无未决违规；后端 translate 旁路已按原则 II 在上方留档，与 003 TTS 旁路同构，不构成架构复杂度违规。
