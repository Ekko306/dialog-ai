# Implementation Plan: 子功能-语音工具-选场景弹出弹窗

**Branch**: `002-scene-select-popup` | **Date**: 2026-10-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-scene-select-popup/spec.md`

**原型图（验收基准）**: `frontend/docs/mockups/子功能-语音工具-选场景弹出弹窗.png`

## Summary

在 Tab1 主页（自由对话）上叠加"选择场景或角色"底部弹窗：横向分类胶囊 + 双列场景卡片 + 底部"自定义场景/角色"占位按钮。点击卡片后通过既有 HITL 内部指令约定（扩展 `_set_context_::<role>::<scenario>`）经 `useLangChainRespond` 回传后端，由新增的最小后端节点 `set_context_node` 调用既有 `save_context` 落 LangGraph Store，下一轮 run 的 `store_resolve_node → resolve_context` 自动读取新场景——实现"立即生效、跨新对话保留、刷新不丢失"，且不触碰 Agent 核心逻辑。前端目录数据为静态 TS 文件（FR-011），UI 基于 Base UI Dialog（脚手架既有 `ui/dialog.tsx` 同源原语）改造为底部弹窗样式。

## Technical Context

**Language/Version**: 前端 TypeScript 5.x（Next.js 16 / React 19，oxlint+oxfmt）；后端 Python 3.11+（LangGraph 1.x，langgraph dev）

**Primary Dependencies**: 前端 `@assistant-ui/react` + `@assistant-ui/react-langchain`（useStreamRuntime / useLangChainRespond / useLangChainInterruptState / useLangChainState）、`@base-ui/react`（Dialog 原语）、`zustand`（跨组件场景状态）、`tailwindcss v4` + `tw-animate-css`（滑入动画）、`lucide-react`；后端 FastAPI（webapp.py 既有挂载，本期不新增端点）、LangGraph Store

**Storage**: 无新增存储。场景持久化复用后端 LangGraph Store（`_CONTEXT_NS=("coach_context",)`，既有）；场景目录为前端静态数据（`lib/scene-catalog.ts`）

**Testing**: 无自动化测试框架（项目仅 oxlint）；验证走 quickstart.md 手动场景 + 浏览器目视比对原型图（Constitution 原则 IV）

**Target Platform**: 桌面/移动浏览器（Next.js SPA），后端 langgraph dev 本地服务（:2024，Next `/api` 代理）

**Project Type**: web（frontend/ + backend/ 双端）

**Performance Goals**: 分类切换与弹窗开合即时响应（SC-005，纯前端 state 驱动，无网络往返）

**Constraints**: 后端仅最小适配（原则 II）；既有对话能力零回归（SC-003）；UI 与原型图逐项目视比对一致（SC-004）

**Scale/Scope**: 5 个分类、约 18~22 个静态场景条目、4 个新前端文件 + 1 个改造文件 + 后端 1 个文件（talk_graph.py）约 25 行增量

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 结论 | 依据 |
|------|------|------|
| I. assistant-ui 框架规范优先 | ✅ 通过 | 已查 assistant-ui MCP（`/docs/runtimes/langchain`）：场景应用用官方 `useLangChainRespond`（interrupt resume 路径，与既有 `_new_context_` 同一范式）；生效验证用官方 `useLangChainState("role"/"scenario")` 响应式读取图状态；弹窗容器用脚手架既有 Base UI Dialog 原语（`ui/dialog.tsx` 同源），不引入新 UI 库 |
| II. 前端适配后端，后端逻辑最小改动 | ✅ 通过（含 1 项留档例外） | 优先方案为前端直传（`runConfig.custom → config.configurable → Runtime context` 别名），但官方文档确认 interrupt helpers 复用 session-scoped recorded configurable、不落 Store、刷新即丢，无法满足 FR-014 持久化。故按既有 `_new_context_` 内部指令约定扩展 `_set_context_`：后端新增 1 个叶子节点 + 1 条路由分支 + HITL 内部指令判定扩展（约 25 行，全部在 talk_graph.py），复用既有 `save_context`/`resolve_context`/Store，**不改** graph 主干结构、coach 子图、CONTEXT_SEQUENCE、resolve 优先级语义。理由已留档（见 Complexity Tracking） |
| III. 现有数据结构复用，读取展示优先 | ✅ 通过 | 场景落点复用 OverAllState 既有 `role`/`scenario` 字段与 Store 既有命名空间；目录条目为前端静态 TS 数据，无后端 schema 变更；弹窗为组件级 overlay，不改主窗口结构 |
| IV. 原型图驱动开发 | ✅ 通过 | spec/plan/quickstart 均显式引用 `frontend/docs/mockups/子功能-语音工具-选场景弹出弹窗.png`；验收走目视比对 |

## Project Structure

### Documentation (this feature)

```text
frontend/specs/002-scene-select-popup/
├── plan.md              # 本文件
├── research.md          # Phase 0 产出：技术决策与依据
├── data-model.md        # Phase 1 产出：实体与状态
├── quickstart.md        # Phase 1 产出：端到端验证指南
├── contracts/
│   ├── scene-apply-command.md   # 前端⇄后端场景应用指令契约
│   └── scene-catalog.md         # 前端静态场景目录数据契约
└── tasks.md             # Phase 2 产出（/speckit-tasks，本命令不创建）
```

### Source Code (repository root)

```text
backend/
└── src/talk_agent/
    └── talk_graph.py    # 唯一后端改动文件：HITL_node 指令判定扩展、
                         # HITL_route 新分支、set_context_node、add_node/边注册

frontend/
├── app/
│   ├── assistant.tsx            # 不改（runtime 入口）
│   └── globals.css              # US3 如需补充弹窗专属色板 token（复用现有绿色系优先）
├── lib/
│   ├── scene-catalog.ts         # 新增：分类 + 场景条目静态数据（FR-011）
│   └── scene-store.ts           # 新增：zustand——pendingScene / apply 反馈状态
└── components/
    ├── main-chat-page.tsx       # 改造："选场景"静态占位 → 可交互按钮挂载弹窗（FR-001）
    └── scene-select/
        ├── scene-select-popup.tsx  # 新增：底部弹窗（Base UI Dialog 改造底部滑出样式）
        ├── scene-applier.tsx       # 新增：监听 interrupt+pendingScene，respond 指令
        └── scene-apply-toast.tsx   # 新增：应用失败可感知提示（FR-013）
```

**Structure Decision**: 前端改动集中在 `components/scene-select/`（新目录，弹窗三件套）+ `lib/`（数据与状态）；后端改动集中在 `talk_graph.py` 单文件的 HITL 分支。不新建后端 HTTP 端点（webapp.py 不动），不新建前端 API 层。

## Complexity Tracking

> 仅记录需论证的 Constitution 例外。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 新增 graph 叶子节点 `set_context_node`（严格意义上触及"graph 结构"） | 场景选择必须写入后端 Store 才能满足 FR-006（立即生效）+ FR-014（跨新对话保留、刷新不丢）；现有节点中只有 `new_context_node` 会写 Store，但它绑定 `CONTEXT_SEQUENCE` 轮换语义，无法指定任意场景 | ① 零后端方案（每轮 run 传 `config.configurable`）：官方文档确认 interrupt helpers 复用 session-scoped recorded configurable、不落 Store，需改动全部 submit 调用点（AutoContinue/NewDialogButton）且刷新丢场景，违反 FR-014；② 复用 `new_context_node`：其语义是"轮换下一个"，改为"指定场景"会破坏既有 HITL 轮换契约（两者并存是 clarify 决策①）。新增叶子节点是复用既有 `save_context`/Store 基建的最小增量，不触碰主干链路与任何既有节点逻辑 |
