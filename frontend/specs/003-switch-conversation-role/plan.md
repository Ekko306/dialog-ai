# Implementation Plan: 切换对话角色与推荐回复

**Branch**: `003-switch-conversation-role` | **Date**: 2026-10-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-switch-conversation-role/spec.md`

**原型图**: `frontend/docs/mockups/子功能-切换对话role.png`（图1 = 主界面消息入口与 AI 消息下方推荐回复样式、图2 = 消息页角色会话列表、图3 = 角色对话页大头像/开场白/推荐回复；需求与验收以该图为对照基准）

## Summary

在 001 三 Tab 主框架的 Tab1 内扩展两条页面级导航（消息页、角色对话页），实现切换对话角色：

1. **消息入口与消息页**：主对话界面左上角静态消息图标升级为按钮，点击进入消息页；消息页全屏展示 12 个内置角色的会话列表（头像/名称/最后消息预览/时间戳/未读角标），返回箭头回到主对话（主对话内容不丢失）。
2. **角色独立会话**：点击角色进入其独立对话页（顶部返回按钮 + 大头像 + 预置开场白 + 与主界面一致的输入区）。每个角色绑定一条独立的 LangGraph 线程：前端为每个角色持久化 `threadId`，`useStreamRuntime` 以受控 `threadId` 挂载——切走再回来时按官方 join-rejoin 机制重新附着线程当前状态与进行中的 run，历史互不串扰；TalkAI助教Ella 的会话即主对话线程（进入 = 返回主对话界面）。
3. **推荐回复**：复用官方 `ThreadPrimitive.Suggestion`（`send`）渲染带语域风格标签（简单/商务）的推荐胶囊，点击即作为用户消息发送。开场白附带的首轮推荐回复预置于角色配置（纯前端）；对话进行中的推荐回复按预留契约读取后端 state key（`useLangChainState("suggestions")`），后端未返回时不展示、不阻塞（FR-010 降级）。
4. **零后端改动**：全部能力在前端完成；后端仅预留推荐回复 state key 契约（见 [contracts/recommended-replies.md](./contracts/recommended-replies.md)），本期不实现。

## Technical Context

**Language/Version**: TypeScript 5.x（strict）+ React 19.3

**Primary Dependencies**: Next.js 16.3.5（App Router，turbopack）、@assistant-ui/react（0.15.x）、@assistant-ui/react-langchain（`useStreamRuntime` / `useLangChainState` / `useLangChainRespond`）、@langchain/react（`useStream` 受控 `threadId`）、@langchain/langgraph-sdk、Tailwind CSS 4.3、zustand 5（含 persist 中间件）、lucide-react、@base-ui/react（shadcn base-nova 风格）

**Storage**: 无新增服务端存储。角色会话历史沿用 LangGraph Server checkpointer（每角色一条 thread）；角色线程映射与列表元数据（最后预览/时间戳/未读数）为前端 localStorage（zustand persist）。

**Testing**: 前端无测试框架（package.json 无 test script）→ 以 [quickstart.md](./quickstart.md) 手动验证为准（与 001/002 一致）。

**Target Platform**: 桌面 + 移动浏览器（沿用 001 目标形态：移动端竖屏优先布局）。

**Project Type**: Web 应用（monorepo：`frontend/` Next.js + `backend/` LangGraph Server，本期后端零改动）。

**Performance Goals**: 消息页 12 个角色列表一次性渲染（纯客户端，秒开）；点击角色后 2 秒内进入对话页并看到开场白（SC-001/SC-002，本地渲染 + 一次线程历史拉取）。

**Constraints**:
- **零后端修改**（Constitution 原则 II）：不改 graph 结构/节点逻辑/状态定义；对话中推荐回复为预留契约，后端未实现前前端按 FR-010 降级。
- 不替换核心运行时方案（Constitution 技术栈约束）：多会话能力必须建立在现有 `useStreamRuntime` 之上，不引入新运行时/新路由方案。
- 角色开场白与推荐回复为前端内置配置数据，MUST NOT 依赖现场生成（FR-006）。

**Scale/Scope**: 3 个用户故事；前端约 10 个文件（新增 6、修改 3、小改 1），后端 0 个文件；12 个角色的静态配置数据 1 份。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 结论 | 依据 |
|------|------|------|
| I. assistant-ui 官方规范优先 | ✅ PASS | 多会话用 `useStreamRuntime` 透传上游 `useStream` 受控 `threadId`/`onThreadId`（官方 join-rejoin 模式，docs.langchain.com 查证留档 research R1）；推荐回复用官方 `ThreadPrimitive.Suggestion`（`send`，直接传 `prompt`，primitives/suggestion 查证留档 research R5）；开场白用 `Thread` 既有 `components.Welcome` 覆盖点（thread.aui.tsx 已内建，见 [thread.aui.tsx](../../../components/thread.aui.tsx) L74/L158）；后端自定义 state 读取用官方 `useLangChainState<T>(key)`（/docs/runtimes/langchain 查证）。全部经 assistant-ui MCP 查证，不凭记忆猜测 API。 |
| II. 前端适配后端，最小后端修改 | ✅ PASS（零后端改动） | 会话隔离复用 LangGraph Server 既有线程机制（每角色一条 thread，同一 graph），后端零改动；对话进行中的推荐回复只**预留** state key 契约（`suggestions`），后端实现与本期解耦，未实现前前端降级不展示（FR-010），理由与契约见 [contracts/recommended-replies.md](./contracts/recommended-replies.md)。 |
| III. 现有数据结构复用，读取展示优先 | ✅ PASS | 消息流/HITL/语音输入沿用现有 `Thread` / `InterruptPrompt` / dictation 体系原样复用；新增数据仅：角色静态配置（纯前端常量，002 scene-catalog 同范式）、角色线程元数据（前端 localStorage）、推荐回复契约（见 contracts）。预览/时间戳/未读均为前端视图层派生与快照，不改后端任何结构。 |
| IV. 原型图驱动开发 | ✅ PASS | 本 plan 已引用原型图路径并完成三图区域映射（图1→消息入口+推荐回复样式、图2→消息列表布局、图3→角色页布局）；data-model / contracts / quickstart 均对照该图展开；tasks 拆步与 implement 后目视比对将以该图为验收基准（SC-005）。 |

**Phase 1 复检（设计完成后）**: 4 项均维持 PASS。设计未引入任何后端文件改动；新增 UI 全部落在官方原语与既有组件扩展点上（Welcome 覆盖、`ThreadPrimitive.Suggestion`、可选 `AssistantSuggestions` 插槽为对 thread.aui.tsx 的最小增量，主界面零行为变化）；数据实体全部为前端态。无违宪项，Complexity Tracking 留空。

## Project Structure

### Documentation (this feature)

```text
frontend/specs/003-switch-conversation-role/
├── plan.md                        # 本文件
├── research.md                    # Phase 0 输出：技术决策与依据
├── data-model.md                  # Phase 1 输出：实体定义（新增 + 复用）
├── contracts/                     # Phase 1 输出：接口契约
│   ├── role-catalog.md            # 角色静态配置数据契约（前端内置）
│   └── recommended-replies.md     # 推荐回复数据契约（配置来源 + 后端预留 state key）
├── checklists/requirements.md     # specify 阶段产出（已有）
├── spec.md                        # specify 阶段产出（已有）
└── tasks.md                       # Phase 2 输出（/speckit-tasks 生成，本阶段不创建）
```

### Source Code (repository root)

```text
frontend/                            # Next.js 16 App Router（assistant-ui langchain 模板）
├── app/
│   ├── assistant.tsx                # 【设计后修订 T012】根 runtime = Ella 主对话线程永不卸载；ShellRoute 上移至此 + 角色树与根 provider 兄弟互斥渲染（原设计【不动】，见 tasks.md T012）
│   ├── page.tsx                     # 【不动】渲染 <Assistant />
│   └── api/[..._path]/route.ts      # 【不动】LangGraph 同源代理（角色线程请求同样经此）
├── components/
│   ├── main-tab-shell.tsx           # 【修改】Tab1 内部 route 状态（tabs / messages / role）；
│   │                                #   子页面全屏渲染并隐藏 TabBar（对照原型图 2/3 无底部 Tab）
│   ├── main-chat-page.tsx           # 【修改】左上角消息图标 MessageCircleMore → 按钮，点击进入消息页（FR-001）
│   ├── messages-page.tsx           # 【新增】消息页：返回箭头 + "消息"标题 + 12 角色会话列表（FR-003/FR-004）
│   ├── role-chat-page.tsx          # 【新增】角色对话页壳：返回按钮 + 音量/设置图标（FR-005）；T017 修订：内层 RoleAssistant 移至 app/assistant.tsx 外层（嵌套产生双 runtime 竞态）
│   ├── role-assistant.tsx          # 【新增】角色级 AssistantRuntimeProvider（FR-007 会话隔离，research R1）；
│   │                                #   T009 修订：受控 threadId 不被转发 → 挂载后 switchToThread + unstable_threadListAdapter，onThreadIdChange 落库
│   ├── role-opening.tsx            # 【新增】Thread components.Welcome 覆盖：角色大头像 + 预置开场白
│   │                                #   + 首轮推荐回复 chips（FR-006/FR-009/FR-010）
│   ├── recommended-replies.aui.tsx # 【新增】推荐回复 chips 渲染器（ThreadPrimitive.Suggestion send，
│   │                                #   风格标签前缀），供开场白与对话中两处复用（FR-009）
│   ├── thread.aui.tsx              # 【小改】ThreadComponents 增加可选 AssistantSuggestions 插槽，
│   │                                #   渲染于 assistant 消息气泡下方（仅最后一条、空闲时）；不传时行为不变
│   ├── interrupt-prompt.tsx        # 【设计后修订】角色页同样复用（同一 graph 的 HITL，respond 协议）；stale interrupt 自动重试（2026-10-27）
│   ├── talk-flow.tsx               # 【设计后修订】AutoContinue 角色页复用 + error 宽限（T018）；NewDialogButton 加 persona/contextCommand props，主/角色页共用（原设计【不动】"仅主界面"）
│   └── server-dictation-adapter.ts # 【不动】语音输入在角色页同样生效（FR-008）
├── lib/
│   ├── role-catalog.ts             # 【新增】12 角色静态配置（契约见 contracts/role-catalog.md）
│   ├── role-thread-store.ts        # 【新增】zustand persist：roleId → threadId/最后预览/时间戳/未读数
│   ├── scene-catalog.ts            # 【不动】002 既有
│   └── scene-store.ts              # 【不动】002 既有
└── docs/mockups/
    └── 子功能-切换对话role.png       # 原型图（本功能唯一视觉基准）

backend/                             # 【零改动】
└── （无任何文件变更；推荐回复 state key 为预留契约，见 contracts/recommended-replies.md）
```

**Structure Decision**: 沿用 monorepo 双目录结构。导航采用 **MainTabShell 内组件级 route 切换**（001 已确立的单页面壳模式延伸）：`tabs`（现有三 Tab）/ `messages`（消息页）/ `role`（角色对话页）三态，子页面全屏渲染并隐藏 TabBar（对照原型图 2/3 均无底部 Tab 栏）。会话隔离采用 **每角色一条 LangGraph 线程 + 受控 threadId 挂载**：根 runtime（Ella/主对话）保持在 Shell 之上永不卸载，切页零成本保持主对话；角色页各自挂轻量 runtime 实例，切走时卸载、run 在服务端继续，切回时按官方 join-rejoin 机制重新附着当前状态与进行中 run（research R1/R2）。不引入 Next.js 多路由、不使用 unstable 线程列表适配器。**实现修订（T009）**：实测受控 `threadId` 不被 useStreamRuntime 转发 → 角色线程附着改为挂载后 `switchToThread` + `unstable_threadListAdapter`（research R1 被拒备选在受控挂载失效后成为实际路径，见 tasks.md T009）。

## Complexity Tracking

> 无 Constitution 违宪项，本节留空。
