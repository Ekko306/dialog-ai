# Research: 子功能-语音工具-选场景弹出弹窗

**Branch**: `002-scene-select-popup` | **Date**: 2026-10-23 | **Spec**: [spec.md](./spec.md)

**原型图（验收基准）**: `frontend/docs/mockups/子功能-语音工具-选场景弹出弹窗.png`

本文件解决 plan.md Technical Context 中的全部待定项，并记录关键技术决策。

---

## R1. 前端如何把"所选场景"传给后端（核心决策）

**Decision**: 采用**后端 HITL 内部指令扩展**方案：前端 `respond("_set_context_::<role>::<scenario>")`，后端新增 `set_context_node` 解析并调用既有 `save_context` 落 Store。

**Rationale**:
1. 后端已有成熟的"内部指令"约定：`HITL_node` 识别 `_new_context_`/`_test_coach_`（不写入 messages、不污染对话流），`HITL_route` 按指令分流。扩展同一约定 = 复用已验证的模式，回归风险最低。
2. 本应用对话流的稳态是"停在 HITL interrupt"（每轮 run 必经 `HITL_node` 中断；`AutoContinue` 续跑后再次停回 interrupt）。因此选择场景时几乎总能用 `useLangChainRespond` 直达后端，无需自建传输通道。
3. `save_context` 落 Store 后，每轮 run 入口 `store_resolve_node → resolve_context` 的三级优先级（显式 context > Store > 默认）自动让 Store 值生效 → **立即生效**（下一条教练回复即新场景）、**跨新对话保留**、**页面刷新不丢**（Store 在后端进程/checkpoint 侧），FR-006/FR-014 一次满足。
4. 前端 `respond` 失败可 catch → 可感知提示（FR-013）。

**Alternatives considered**:
- **A. 每轮 run 传 `config.configurable`（零后端改动）**：查证 assistant-ui 官方文档 `/docs/runtimes/langchain` §"Forwarding per-run config"：消息的 `runConfig.custom` 会转发为 `config.configurable`，且 LangGraph v1 上该值别名为 Runtime `context`（即后端 `runtime.context` 能读到 → `resolve_context` 显式优先生效）。**但**：`useLangChainRespond`/`useLangChainRespondAll` 等 interrupt helpers 只"复用 session-scoped recorded configurable"，原生 `useLangChainSubmit` 新 run 不继承；记录不跨页面刷新刷新丢失；且不写 Store → AutoContinue 的 `submit({})` 等调用点必须逐一改造传 config，遗漏即静默回退默认场景。违反 FR-014，否决。
- **B. 复用 `new_context_node`**：其语义是按 `CONTEXT_SEQUENCE` 轮换"下一个"，与 clarify 决策①"两者并存"冲突，否决。
- **C. 新增 FastAPI 端点直接写 Store**（仿 001 `/audio/transcribe`）：webapp.py 的自定义 FastAPI app 拿不到 langgraph dev 分配给 graph 的 Store 实例（无公开 API），需要 hack，否决。
- **D. 图输入 state 直传 `role`/`scenario`**：`store_resolve_node` 只从 `runtime.context`/store 解析，输入字段会被覆盖，需改 resolve 优先级语义（触碰既有"三级优先"设计且影响 Studio 传参行为），否决。

**已知边界（v1 接受）**：冷启动场景——用户在**尚无任何对话**时打开弹窗选场景：此时无 interrupt 可 respond，选择暂存于 zustand（pendingScene），待对话首轮 run 停到首个 interrupt 时由 SceneApplier 自动补发指令。首轮教练话题仍为默认场景，第二轮起生效。此为最小实现代价，后续可通过后端在 `resolve_context` 显式来源时回写 Store 消除（已记录为可选增强，本期不做）。

## R2. 场景选择与既有 HITL 中断的并存行为

**Decision**: 选择场景 = 用 `_set_context_` 指令"应答"当前挂起的 interrupt（与"新会话"按钮在 interrupt 态发 `_new_context_` 完全同一模式）；指令分流优先级 `_set_context_` 独立分支 → `set_context_node` → END → AutoContinue 自动续跑。

**Rationale**:
- 稳态下 interrupt 就是"教练等待输入"，选场景即是一种输入，天然合法。
- spec 边界用例"正在 HITL 中断时选场景不破坏中断流程"：中断应答入口（InterruptPrompt）不受影响——用户仍可先打字应答；若用户选择改答"换场景"，则该轮按新场景收尾并续跑，与点"新会话"切换场景的行为一致（既有 UX 约定）。
- HITL 中 pending 的是"是否生成语音"（audio_choice）时选场景：场景指令优先收尾本轮（跳过语音询问），不产生幽灵消息（指令不入 messages）。

**Alternatives considered**: 排队等用户先答完 interrupt 再应用场景——引入待答/待应用双队列状态机，复杂度不成比例，否决。

## R3. 生效验证与失败提示（FR-013）

**Decision**:
- **生效验证**：`useLangChainState<string>("scenario")` / `("role")` 官方 hook 响应式读取图状态（`OverAllState` 既有字段），用于 quickstart 验证与调试展示；UI 不新增常驻场景指示器（原型图无此元素）。
- **失败提示**：`respond()` promise reject 时（网络/服务异常），经 zustand `applyError` 触发轻量 toast（自绘，项目无 toast 基建），并**清除 pendingScene 保留当前生效场景**——与 FR-013"保留当前场景、不中断对话"一致。
- 后端解析失败（字段缺失）回退默认值并记 logger，不抛错（前端静态目录数据保证载荷良构，此路径仅为防御）。

**Alternatives considered**: 引入 sonner 等成熟 toast 库——超出最小需求，自绘 ~20 行组件足够。

## R4. 弹窗容器与动画方案

**Decision**: 基于 `components/ui/dialog.tsx` 同源的 Base UI Dialog 原语（`@base-ui/react` 既有依赖）自建 `SceneSelectPopup`：Backdrop + Popup 定位改为底部贴边、顶部大圆角、`tw-animate-css` 的 `data-open:animate-in slide-in-from-bottom` 滑入/滑出；弹窗内关闭按钮复用 `DialogPrimitive.Close`。

**Rationale**:
- 原型图弹窗是"底部滑出 sheet"而非居中 modal：复用 Dialog 的无障碍能力（焦点圈定、Esc/遮罩关闭、aria）只改定位与动画类，符合原则 I"优先用框架组件"。
- Base UI Dialog 关闭时默认卸载 Popup 内容 → 弹窗内部 state（选中分类、选中卡片）随关闭自动重置，天然满足 clarify 决策③"每次打开回到默认状态（热门，无选中标记）"，零额外代码。
- 项目已有 `ui/dialog.tsx` 封装（001 验证过），但其中 `DialogContent` 是居中样式；本期新建组件直接使用原语，不反向改动既有封装（避免影响未知调用方）。

**Alternatives considered**: 纯 div + fixed 定位手写——丢失焦点管理/无障碍；radix-dialog——项目未依赖（用的是 @base-ui/react）；底部固定 div 常驻——与"滑出/收回"动画语义不符。

## R5. 场景目录静态数据设计（FR-011 / clarify 决策④）

**Decision**: `lib/scene-catalog.ts` 导出 `SCENE_CATALOG`：5 个分类（热门/今日话题/日常交流/旅游出行/职场）+ 条目数组。条目字段：`id`、`category`、`emoji`、`nameZh`、`nameEn`、`role`、`scenario`。热门分类=精选子集（原型图可见 6 项：爱好/hobby、求职面试/Job Interview、办理登机/Check in、问路/Asking for directions、点下午茶/Order afternoon tea、黑色星期一/Black Monday）；其余分类按主题合理拟定（用户可随时替换静态数据）。`role` 默认 `英语口语教练`，`scenario` 取话题中文名；职场分类部分条目映射既有 `商务英语教练`。

**Rationale**: 后端 `coach_reply_node` 仅把 `role`/`scenario` 拼进教练 prompt（`get_coach_model(role, scenario)`），任意中文串均可生效——无需扩展后端 `CONTEXT_SEQUENCE`（轮换语义保持不动）；映射字段前置在条目上，后端零改动。

**Alternatives considered**: 目录由后端接口提供——clarify 决策④明确 v1 前端静态维护，接口属增量扩展；emoji 用图片资源——原型图即 emoji，且系统字体渲染零资源成本。

## R6. 主题色与样式 token（US3）

**Decision**: 弹窗配色优先复用既有 CSS 变量：选中胶囊与底部按钮的浅绿用 `--bubble-ai`（#D3FF98，与原型图黄绿高亮同族）、强调绿用 `--icon-brand-green`（#61DA07）、弹窗白底用 `--popover`/`--background`、卡片浅灰底用 `--secondary`/`--muted`、圆角用既有 `--radius-2xl`/`rounded-3xl` 体系。若目视比对发现色差，允许在 globals.css 增补弹窗专属 token（如 `--scene-highlight`），不改动既有变量语义。

**Rationale**: 原则 III（复用既有）；001 已按原型图采样建立绿色系 token，弹窗属同族视觉。

## R7. 后端改动清单（原则 II 留档，全部位于 `backend/src/talk_agent/talk_graph.py`）

1. `HITL_node`：内部指令判定由"`_new_context_`/`_test_coach_` 不写 messages"扩展为三元组包含 `_set_context_`（1 处条件改动）。
2. `HITL_route`：新增 `"set_context"` 返回分支（`_set_context_` 优先于 audio_check 判定）。
3. 新增 `set_context_node(state, runtime)`：解析 `_set_context_::<role>::<scenario>` → `save_context(runtime.store, role, scenario)` → 写回 `role`/`scenario`/`logger`（字段均为 OverAllState 既有 key）。
4. `add_node("set_context_node", ...)` + `HITL_route` path_map 登记 + `add_edge("set_context_node", END)`。

**不改**：graph 主干链路、`resolve_context`/`save_context`/`CONTEXT_SEQUENCE`、coach/grammar/polisher 子图、OverAllState/SubgraphState 定义、webapp.py。改动量约 25 行，单文件。

## R8. 受影响前端调用点盘点（零回归核对表）

| 既有能力 | 机制 | 本期改动 | 回归风险 |
|---------|------|---------|---------|
| 新建对话（首轮） | `NewDialogButton.submit({})` | 不改 | 无 |
| 新会话/切换下一个场景 | interrupt 态 `respond("_new_context_")` | 不改 | 无 |
| HITL 应答 | `InterruptPrompt.respond(文本)` | 不改（`_set_context_` 指令串不会与用户输入混淆：仅由 SceneApplier 程序化发送） | 无 |
| 自动续跑 | `AutoContinue` 两段 settle 后 `submit({})` | 不改 | 无 |
| 消息渲染 | `thread.aui.tsx` / `messages` 唯一来源 | **行为零改动**（指令不写 messages 由 HITL_node 判定扩展保证）；仅 US3 允许输入条样式类调整（T012），渲染数据流与消息逻辑不动 | 无（样式微调不影响行为） |
| "选场景"入口 | `main-chat-page.tsx` 静态 span（001 FR-010 占位） | 替换为按钮 + 挂弹窗（本期 FR-001 的自然演进） | 低（纯 UI 替换） |
