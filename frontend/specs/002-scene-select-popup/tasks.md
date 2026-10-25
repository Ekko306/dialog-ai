---

description: "Tasks for feature 002-scene-select-popup"
---

# Tasks: 子功能-语音工具-选场景弹出弹窗

**Input**: Design documents from `/specs/002-scene-select-popup/`

**Prerequisites**: plan.md（必需）、spec.md（必需）、research.md、data-model.md、contracts/scene-apply-command.md、contracts/scene-catalog.md、quickstart.md

**Tests**: 项目无自动化测试框架（spec 未要求）；各故事验证以 quickstart.md 手动场景 + 原型图目视比对为准（Constitution 原则 IV）。

**Organization**: 按用户故事分组（US1 弹窗浏览 P1 → US2 选场景生效 P2 → US3 UI 对齐 P2 → US4 自定义按钮占位 P3）。

**原型图（验收基准）**: `frontend/docs/mockups/子功能-语音工具-选场景弹出弹窗.png`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无依赖）
- **[USx]**: 所属用户故事
- 描述含确切文件路径

## Path Conventions

- 前端：`frontend/lib/`、`frontend/components/scene-select/`（新目录）、`frontend/app/`
- 后端：`backend/src/talk_agent/talk_graph.py`（唯一后端改动文件）

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 两个故事共用的静态数据源

- [X] T001 [P] 创建场景目录静态数据 `frontend/lib/scene-catalog.ts`：按 contracts/scene-catalog.md 导出 `CategoryId`/`SceneCategory`/`SceneCatalogEntry` 类型与 `SCENE_CATEGORIES`（5 分类，hot 恒为 order 最小）、`SCENE_CATALOG`（热门 6 项精确对齐原型图：爱好/hobby✨、求职面试/Job Interview💻、办理登机/Check in✈️、问路/Asking for directions🛣️、点下午茶/Order afternoon tea🥞、黑色星期一/Black Monday🎒；其余 4 分类各拟 3~4 项）；约束逐条落实：条目 `id` 唯一、`nameZh` 非空、`nameEn` 可缺省、默认 `role="英语口语教练"`、`scenario=nameZh`（职场分类可复用 `商务英语教练/职场会议`）、所有 `role`/`scenario` 不得含 `::`、纯常量无副作用

**Checkpoint**: 静态数据就绪；US1 可立即开始（本特性无阻塞型 Foundational 任务，zustand 状态属 US2 实现内容）

---

## Phase 3: User Story 1 - 从主页打开场景弹窗并浏览分类与话题 (Priority: P1) 🎯 MVP

**Goal**: 点"选场景"唤起底部弹窗，可滑动分类、滚动浏览双列话题卡片、关闭弹窗，全程不报错且不影响主页对话

**Independent Test**: 仅实现本故事即可演示：从主页唤起弹窗 → 滑动分类 → 切换分类 → 滚动卡片 → 关闭 → 再开回到默认态（quickstart.md §1）

### Implementation for User Story 1

- [X] T002 [US1] 创建弹窗骨架 `frontend/components/scene-select/scene-select-popup.tsx`：基于 `@base-ui/react` Dialog 原语（`components/ui/dialog.tsx` 同源，不改动既有封装）；Backdrop + Popup 贴底定位（非居中）、白色底 `--popover`、顶部大圆角（`rounded-t-3xl` 体系）、`tw-animate-css` 的 `data-open:animate-in slide-in-from-bottom` / `data-closed:animate-out slide-out-to-bottom` 滑入滑出；标题栏：左侧"选择场景或角色"、右上 `DialogPrimitive.Close` × 按钮；关闭即卸载内容（Base UI 默认），保证内部 state 每次打开重置（clarify 决策③：默认"热门"、无选中标记）
- [X] T003 [US1] 在 `scene-select-popup.tsx` 内实现弹窗内容区：①分类胶囊栏——`SCENE_CATEGORIES` 按 `order` 渲染一行、`overflow-x-auto` 横向滑动、`activeCategory` useState 初值 `"hot"`、选中态绿色高亮胶囊 / 未选中浅色胶囊（token 按 research R6：优先 `--bubble-ai`/`--icon-brand-green`）；②双列卡片网格 `grid grid-cols-2`——过滤 `entry.category === activeCategory`、卡片含 emoji（渲染失败降级占位圆形）+ 中文话题名 + 英文名（`nameEn` 缺省只显示中文）、内容区 `overflow-y-auto` 纵向滚动、过滤为空时展示空态提示不崩溃
- [X] T004 [US1] 改造 `frontend/components/main-chat-page.tsx`：把底部"选场景"静态 span（`aria-label="选场景（暂未开放）"`）替换为可交互按钮并挂载 `SceneSelectPopup`（FR-001），保持与 `NewDialogButton` 居中并列的原有布局与样式风格；`NewDialogButton`/`InterruptPrompt`/`AutoContinue`/`Thread` 一律不动（research R8 零回归核对表）

**Checkpoint**: US1 独立可测——跑 quickstart.md §1 全部 7 步通过（含 1.7 再次打开回默认态）；此时点卡片无应用行为（属 US2）

---

## Phase 4: User Story 2 - 点击话题卡片进入对应场景对话 (Priority: P2)

**Goal**: 点击卡片关闭弹窗并把所选角色/场景立即应用于当前对话（下一条教练回复即新场景），跨新对话保留、刷新不丢；既有对话能力零回归

**Independent Test**: 选定场景后发送消息，人工判读回复贴合场景；再用"新建对话"与一次 HITL 应答验证无回归（quickstart.md §2）

### Implementation for User Story 2

- [X] T005 [P] [US2] 后端最小改动 `backend/src/talk_agent/talk_graph.py`（严格按 contracts/scene-apply-command.md §3，research R7 清单）：①`HITL_node` 内部指令判定扩展为包含 `"_set_context_"`（命中则不写 messages）；②`HITL_route` 新增 `set_context` 分支（`"_set_context_" in user_input` 优先判定）；③新增 `set_context_node(state, runtime: Runtime[CoachContext])`——按 `::` 切分 `user_input` 取第 2/3 段为 role/scenario（缺失或空白回退 `DEFAULT_ROLE`/`DEFAULT_SCENARIO`，不抛错）→ 调用既有 `save_context(runtime.store, role, scenario)` → 返回 `{"role", "scenario", "logger": [追加切换日志]}`；④`add_node("set_context_node", ...)` + `HITL_route` path_map 登记 `"set_context"` + `add_edge("set_context_node", END)`。红线：不改主干链路、resolve_context/save_context/CONTEXT_SEQUENCE、子图、state 定义（Constitution 原则 II，理由已留档 plan.md Complexity Tracking）
- [X] T006 [P] [US2] 创建跨组件场景状态 `frontend/lib/scene-store.ts`：zustand store 按 data-model.md §4——`pendingScene: { role: string; scenario: string } | null`、`applyError: string | null` 及动作（`requestScene(entry)` 写 pending、`clearPending()`、`setApplyError/clearApplyError`）；纯内存态不持久化
- [X] T007 [US2] 在 `frontend/components/scene-select/scene-select-popup.tsx` 增加卡片点击行为：瞬态 `selectedEntryId` 高亮 → 调用 `requestScene(entry)` 写入 `pendingScene`（取条目 `role`/`scenario`）→ 立即关闭弹窗（FR-006）；本期不弹任何"已选择"提示
- [X] T008 [US2] 创建指令发送器 `frontend/components/scene-select/scene-applier.tsx`：`useLangChainInterruptState()` + `useLangChainRespond()`；`useEffect` 监听 `pendingScene` 与 interrupt——两者齐备时 `respond("_set_context_::<role>::<scenario>")`（contracts/scene-apply-command.md §2）：成功 `clearPending()`；失败（promise reject）`clearPending()` + `setApplyError(提示文案)`（保留当前生效场景、不中断对话，FR-013）。禁令：指令绝不作为普通消息发送；`interrupt == null`（运行中/冷启动）时只暂存待下一个 interrupt 出现自动补发。挂载到 `main-chat-page.tsx`（AssistantRuntimeProvider 树内）
- [X] T009 [US2] 创建失败提示 `frontend/components/scene-select/scene-apply-toast.tsx`：读 `applyError` 的自绘轻量 toast（fixed 底部居中、`bg-destructive`/白字、约 3s 自动消失并 `clearApplyError`，~20 行，项目无 toast 基建不自造依赖）；挂载到 `main-chat-page.tsx`
- [X] T010 [US2] 全链路验证：按 quickstart.md §2 逐步执行（2.1 指令不污染对话流、2.2 下一轮回复贴合场景、2.3/2.4 跨新对话与刷新保留、2.5 HITL 应答无回归、2.6 `_new_context_` 轮换并存）；后端启动须 `$env:PYTHONUTF8=1` + `uv run langgraph dev --no-reload`（项目约定）

**Checkpoint**: US1 + US2 同时可用；SC-001（3 次点击完成切换）与 SC-003（回归零破坏）达成

---

## Phase 5: User Story 3 - UI 视觉对齐原型图 (Priority: P2)

**Goal**: 功能通路完成后按原型图逐项优化视觉：弹窗圆角配色、胶囊选中态、卡片样式、主页底部输入框与按钮区

**Independent Test**: 实现界面与 `frontend/docs/mockups/子功能-语音工具-选场景弹出弹窗.png` 并排目视比对一致（quickstart.md §3 checklist）

### Implementation for User Story 3

- [X] T011 [P] [US3] 视觉精修 `frontend/components/scene-select/scene-select-popup.tsx` 与 `frontend/app/globals.css`：对照原型图核对弹窗顶部圆角、白色底、标题栏布局；选中胶囊黄绿高亮（`--bubble-ai` 族）与未选中浅色胶囊的色值/内边距/字号；卡片浅灰底、圆角、emoji 底部中文+英文排版与间距；如目视比对发现色差，允许在 globals.css 增补弹窗专属 token（如 `--scene-highlight`），不改既有变量语义（research R6）
- [X] T012 [US3] 主页底部样式对齐 `frontend/components/main-chat-page.tsx`（必要时对 `frontend/components/thread.aui.tsx` 输入条做**仅样式类**调整——行为零改动，与 research R8 口径一致）：输入框与"新会话/选场景"按钮区的圆角、配色、间距与原型图风格一致；逻辑与渲染数据流一律不动（FR-007）
- [X] T013 [US3] 目视比对验收：打开弹窗与原型图并排，逐项勾掉 quickstart.md §3 checklist（弹窗、胶囊、卡片、底部按钮、主页输入区），不一致处以原型图为准

**Checkpoint**: SC-004 达成（逐项目视比对一致）

---

## Phase 6: User Story 4 - 底部"自定义场景/角色"入口 (Priority: P3)

**Goal**: 弹窗底部固定展示浅绿胶囊按钮，本期占位：可见、可点击、不报错

**Independent Test**: 打开弹窗可见底部按钮，点击后无报错且弹窗状态正常（quickstart.md §4）

### Implementation for User Story 4

- [X] T014 [US4] 在 `frontend/components/scene-select/scene-select-popup.tsx` 增加底部固定按钮：浅绿色（`--bubble-ai` 族）胶囊样式"自定义场景/角色"、`absolute`/flex 固定于弹窗底部不随话题列表滚动（FR-009）；~~onClick 为占位 no-op~~（用户扩展：已升级为真实功能，见 T018），点击不报错、弹窗与对话状态正常

**Checkpoint**: US4 验收两项通过；弹窗结构与原型图完全对齐

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 边界用例、回归冒烟与代码质量收尾

- [X] T018（用户扩展需求，超出原 spec US4 占位范围）自定义场景/角色功能：`frontend/components/scene-select/scene-select-popup.tsx` 增加 custom 双视图表单（返回箭头/角色选填默认"英语口语教练"/场景必填/`开始对话`按钮空场景禁用）；输入净化 `sanitizeSceneInput`（`::`→全角冒号、截断 24 字符）；复用 `requestScene` → `_set_context_` 既有生效链路（FR-006/FR-014 自动满足）；后端 `backend/src/talk_agent/talk_graph.py` set_context_node 同步 24 字符截断防御。已 E2E 验证：自定义"咖啡店店员/在咖啡店用英语点单"→ 教练以店员角色按场景出题

- [X] T015 边界用例抽查：按 quickstart.md §5 执行（快速反复开合、运行中选场景、HITL 挂起时选场景、停服务选场景→FR-013 失败提示、临时清空某分类→空态）；已知边界按 quickstart §6 口径判定（冷启动首轮默认场景、audio_choice 中断上选场景跳过语音询问）。实测（browser_use 多轮）：快速开合 5 次无叠层/长对话滚动位置不跳变/HITL 挂起选场景中断入口保留且下轮话题生效/运行中选场景无报错/临时清空热门→空态"该分类暂无场景"正常显示。FR-013 双路径实证：①respond 被拒（run 崩溃/ERR_ABORTED）→红色"场景应用失败"toast；②无 interrupt（停服/冷启动）→新增中性"场景已暂存，将在对话恢复后生效"toast（scene-store.applyNotice + applier 补发 effect + toast 双态样式），后端恢复后暂存指令自动补发（新会话话题即暂存场景，已闭环验证）。注：初次复测 toast 未出现为 HMR 陈旧 bundle，重启 dev server 后通过
- [X] T016 后端回归冒烟：`$env:PYTHONUTF8=1` + `uv run langgraph dev --no-reload` 启动无 GraphLoadError；父图编译正常；既有三条指令行为逐字节不变（`_new_context_` 轮换、`_test_coach_` 跳过、普通文本写 messages，contracts/scene-apply-command.md §5 不变量）——SSE resume 探针实测：T1 test_coach→直接 END / T2 new_context→轮换（爱好→日常闲聊）落 store→END / T3 普通文本→messages_written→语法链 / T4 set_context→同 run 续跑 coach（002 新路径）
- [X] T017 前端质量门：`pnpm lint`（oxlint + oxfmt --check）通过；确认 `NewDialogButton`/`AutoContinue`/`InterruptPrompt`/`Thread`（thread.aui.tsx，US3 输入条样式类调整除外）/`components/ui/dialog.tsx` **行为零改动**，后端 `resolve_context`/`save_context`/`CONTEXT_SEQUENCE`/子图未改动（research R8 核对表逐项过一遍）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**: 无依赖，立即开始
- **US1（Phase 3）**: 依赖 T001；MVP 载体，优先完成
- **US2（Phase 4）**: 依赖 US1 完成（卡片点击行为挂在 T003 的弹窗上）；T005（后端）与 T006（store）互相独立可并行
- **US3（Phase 5）**: 依赖 US2（spec 明确"功能通路完成后再做 UI 优化"）
- **US4（Phase 6）**: 依赖 US1（弹窗存在即可做）；建议在 US3 后做以一次成型对齐原型
- **Polish（Phase 7）**: 依赖全部故事完成

### User Story Dependencies

- US1 → US2 → US3 为主链；US4 可在 US1 后任意时点插入（与 US2/US3 无文件冲突——同文件 `scene-select-popup.tsx` 需串行编辑）
- T005（后端）与 T006/T007/T008/T009（前端）分属不同端，可全程并行

### Parallel Opportunities

- T001 与任何任务无依赖，可最先并行启动
- T005 ∥ T006（不同端、不同文件）
- T011 ∥ T012（不同文件）
- T016 ∥ T017（后端冒烟 ∥ 前端质量门）

---

## Parallel Example: User Story 2

```text
# 前后端并行：
Task: "T005 后端 talk_graph.py set_context_node + HITL 扩展"
Task: "T006 前端 lib/scene-store.ts zustand store"
# 之后串行：T007（弹窗点击）→ T008（applier）→ T009（toast）→ T010（验证）
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001 → T002 → T003 → T004
2. **STOP and VALIDATE**: quickstart.md §1 全通过，弹窗浏览完整可演示

### Incremental Delivery

1. MVP（US1）→ 2. US2 场景生效（价值闭环）→ 3. US3 视觉对齐（验收硬基准）→ 4. US4 占位 → 5. Polish 收尾
3. 每个故事停在 Checkpoint 独立验证后再前进

---

## Notes

- [P] 任务 = 不同文件、无依赖，可并行
- 所有验证以 quickstart.md 场景 + 原型图目视比对为准；无自动化测试任务（spec 未要求）
- 后端任何启动验证必须带 `PYTHONUTF8=1` 与 `--no-reload`（项目约定）
- 每完成一个逻辑组建议提交一次（仅推送到 zzl 分支族，禁改 main）
