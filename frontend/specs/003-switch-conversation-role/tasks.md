---
description: "Tasks for 003-switch-conversation-role feature implementation"
---

# Tasks: 切换对话角色与推荐回复

**Input**: Design documents from `frontend/specs/003-switch-conversation-role/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/role-catalog.md, contracts/recommended-replies.md, quickstart.md

**原型图（唯一视觉基准，Constitution 原则 IV）**: `frontend/docs/mockups/子功能-切换对话role.png`（图1 = 主界面消息入口与 AI 消息下方推荐回复样式、图2 = 消息页角色会话列表、图3 = 角色对话页大头像/开场白/推荐回复）

**Tests**: 前端无自动化测试框架（package.json 无 test script），以 quickstart.md 手动验证为唯一验收手段。未请求自动化测试，故不含测试编写任务。

**Organization**: 按用户故事分组（US1 消息入口与角色会话列表 → US2 角色独立对话与会话隔离 → US3 AI 消息的推荐回复），每个故事可独立验证交付。

**红线（贯穿所有阶段）**:
- **后端零改动**：本特性无任何 backend 任务；不改 graph 结构/节点逻辑/状态定义；对话中推荐回复为预留契约（contracts/recommended-replies.md §2），后端未实现前前端按 FR-010 降级（Constitution 原则 II）
- **不替换核心运行时**：多会话能力建立在现有 `useStreamRuntime` 之上，不引入新运行时/新路由方案/`useRemoteThreadListRuntime`（Constitution 技术栈约束；research R1）
- **开场白与首轮推荐回复为配置数据**：MUST NOT 依赖现场生成（FR-006）；文案用户可随时改 `lib/role-catalog.ts`，UI 与逻辑零改动

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 对应 spec.md 用户故事（US1/US2/US3）
- 描述含确切文件路径

## Path Conventions

- 前端：`frontend/app/`、`frontend/components/`、`frontend/lib/`（assistant-ui 脚手架结构）
- 后端：无任何改动

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 环境就绪确认与既有行为基线记录

- [x] T001 [P] 确认前端环境：在 `frontend/` 执行 `pnpm install` 并 `pnpm dev` 启动成功（localhost:3000）；记录 001 既有行为基线（主对话收发、HITL 回复、语音输入、三 Tab 切换、左上角 `MessageCircleMore` 静态图标现状各一步操作结果），作为"001 行为不回归"的对照基准（quickstart 1.1）
- [x] T002 [P] 确认后端环境：`backend/` 执行 `uv run langgraph dev` 启动成功（Server started at http://localhost:2024）；核对 `frontend/.env*` 中 `NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID` 与 `backend/langgraph.json` 键名一致（quickstart 前置条件表）

**Checkpoint**: 前后端均可启动，001 基线已记录

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 跨故事共享的数据契约层（US1 列表渲染、US2 会话隔离、US3 推荐回复全部依赖）

**⚠️ CRITICAL**: 两个 lib 文件为全部用户故事的阻塞前置项，完成后才能进入用户故事

- [x] T003 [P] 新建 `frontend/lib/role-catalog.ts`：角色目录静态配置，完全照搬 002 `frontend/lib/scene-catalog.ts` 范式（模块级常量 + 类型导出、消费方只读、零副作用零请求；research R3）。契约 [contracts/role-catalog.md](../contracts/role-catalog.md) 全量落地：导出 `RoleOpeningSuggestion{label,text}`、`RoleAvatar`（`{kind:"image";src}` | `{kind:"initial";char;colorClass}`）、`RoleCatalogEntry{id,name,avatar,tagline,opening,openingSuggestions}`、`ROLE_CATALOG`（12 项）、`MAIN_ROLE_ID = "alicia"`、`getRole(id)`。12 角色清单以 spec FR-003 原文为准（alicia/lisa/ella/sally/mira/zora/david/dylan/luke/fiona/piper/sarah）；`lisa` 开场白 = spec FR-006 原文逐字（"Hi, 我是Lisa。我会用中文对你发出的英语进行纠错及润色，再用英语维持对话，我们开始吧！What's new today?"）**不得改动**；图2 可见预览的角色（alicia/mira/zora/david/luke/sally/ella）参照原型图 2 截图文案，其余按身份合理拟定；每角色 `openingSuggestions` 固定 2 条（简单/商务各一，`label` 非空），`alicia` 为空数组（长度约束 0~2，contract §2/§4）；头像 MVP 全部 `{kind:"initial", char:名称首字符, colorClass:预设色}` 形态（contract §2 头像说明）。**实现修订（2026-10-27）**：头像实际交付为 `{kind:"image", src:"/roles/<id>.jpg"}` 真实图片（`frontend/public/roles/` 12 张），`initial` 形态保留为消费方兜底分支（contract role-catalog §2 已同步）。不变量：`id` 稳定唯一（路由/存储 key）、`opening` 非空
- [x] T004 [P] 新建 `frontend/lib/role-thread-store.ts`：zustand + `persist` 中间件（localStorage key **`talkai-role-threads`**），数据契约 [data-model.md](../data-model.md) §2 逐字落地：`RoleThreadMeta{roleId, threadId: string|null, lastPreview: string（≤60 字符截断）, lastActivityAt: number|null, unreadCount: number}`，`metas: Record<string, RoleThreadMeta>`（key = roleId）；actions：`enterRole(roleId)`（unreadCount 归零，FR-004）、`leaveRole(snapshot{roleId, threadId, lastPreview, hasNewActivity})`（写 lastPreview + `lastActivityAt = Date.now()`；hasNewActivity → `unreadCount += 1`）、`setThreadId(roleId, threadId)`（onThreadId 落库）。**消息正文不入库**（真值在 LangGraph checkpointer，Constitution 原则 III）；未读语义 = "离开该会话时它还有未完结的动静"，非精确条数（research R4 规则表）；localStorage 不可用时 zustand persist 自动降级内存态（research R8 已知限制，不做额外处理）

**Checkpoint**: 数据契约层就绪 —— 角色配置与线程元数据可被所有用户故事消费

---

## Phase 3: User Story 1 - 消息入口与角色会话列表 (Priority: P1) 🎯 MVP

**Goal**: 主对话界面左上角消息入口可点击，进入全屏消息页展示 12 角色会话列表（头像/名称/最后消息预览/时间戳/未读角标），返回箭头回到主对话且内容不丢失

**Independent Test**: 打开主对话界面 → 点击消息入口 → 观察角色列表内容与样式 → 点击返回 → 确认原对话保留（spec US1 独立测试）

### Implementation for User Story 1

- [x] T005 [P] [US1] 新建 `frontend/components/messages-page.tsx`：全屏消息页（对照原型图 2）。结构：左上返回箭头（props `onBack`）+ 居中"消息"标题 + 12 角色会话列表。数据 = `ROLE_CATALOG` 全量渲染 + `role-thread-store` 元数据派生，视图层派生规则按 data-model §2 逐条实现：预览 = `meta.lastPreview` 非空用它、否则用 `catalog.opening` 截断摘要（从未活跃角色，spec Edge Case）；时间戳 = `lastActivityAt` 当天 HH:MM / 非当天 MM-DD / null 显示 "—"；排序 = 有 `lastActivityAt` 的按其降序在前、无记录的按 ROLE_CATALOG 配置顺序垫底；角标 = `unreadCount > 0` 显示红色圆形数字角标。列表项点击回调 props `onSelectRole(roleId)`（分发逻辑在 Shell，不在本组件，research R2）；本组件不持有导航状态、不写 store（纯展示 + 回调上抛）
- [x] T006 [P] [US1] 修改 `frontend/components/main-chat-page.tsx`：左上角静态 `MessageCircleMore` 图标升级为消息入口按钮，新增 props `onOpenMessages`（点击回调，FR-001）；页面其余结构（顶部栏/对话流/底部按钮区/001 行为）零改动
- [x] T007 [US1] 修改 `frontend/components/main-tab-shell.tsx`（依赖 T005/T006）：引入 `ShellRoute` 三态 route 状态（data-model §4：`{name:"tabs"} | {name:"messages"} | {name:"role"; roleId: string}`，`useState` 内存态不持久化、刷新回主界面）。route=tabs：现有三 Tab 壳原样（TabBar 可见）；route=messages：全屏渲染 `<MessagesPage onBack onOpenRole />`，**TabBar 不渲染**（原型图 2 无底部 Tab）；MainChatPage 传 `onOpenMessages={() => setRoute({name:"messages"})}`；MessagesPage 传 `onSelectRole`：`id === MAIN_ROLE_ID` → `setRoute({name:"tabs"})`（Ella = 主对话线程，点击即回主对话，spec Assumption；quickstart 1.5），其他角色本阶段暂不分发（role 路由在 US2 T012 接入）。**Ella 元数据快照接线**：MainChatPage 挂载/卸载生命周期接 role-thread-store——mount 调 `enterRole(MAIN_ROLE_ID)`（未读清零），unmount 调 `leaveRole` 快照（从根 runtime 读最后一条消息截断 60 字符为 lastPreview；离开时 `isRunning` 或有未消费新消息 → `hasNewActivity: true`；research R4 规则表；quickstart 1.4/1.5 依赖此接线）
- [x] T008 [US1] 手动验证 US1（依赖 T003–T007）：对照 quickstart.md 1.1–1.7（入口 2 秒内进入消息页、12 角色全部渲染 = SC-001、布局对照原型图 2、未进入角色预览=开场白摘要/时间戳"—"/无角标、Ella 对话后列表预览更新、对话进行中切走 Ella 行显示角标+点击 Ella 返回后角标清除且对话原样保留、返回箭头内容不丢 = FR-002、反复快速切换无白屏无 console 错误）+ spec US1 验收场景 1–4

**Checkpoint**: User Story 1 可独立使用：消息入口 → 角色列表 → 返回主对话全链路可用，001 行为不回归

---

## Phase 4: User Story 2 - 选择角色进入独立对话与会话隔离 (Priority: P2)

**Goal**: 点击消息页任一角色进入其独立对话页（返回按钮 + 大头像 + 预置开场白 + 与主界面一致的输入区）；每角色一条独立 LangGraph 线程，历史互不串扰、切换后保留、切回时 join-rejoin 恢复

**Independent Test**: 依次进入两个不同角色各发送一条消息 → 返回消息页 → 再分别进入这两个角色 → 核对各自的对话内容与开场白（spec US2 独立测试）

### Implementation for User Story 2

- [x] T009 [P] [US2] 新建 `frontend/components/role-assistant.tsx`：角色级 `AssistantRuntimeProvider`（research R1 核心决策）。props `{roleId}`；内部 `useStreamRuntime` 受控挂载：`threadId` 取 `role-thread-store` 中该角色持久化的 `threadId`（null/undefined = 首次进入，首次发送时 `useStream` 自动建线）、`onThreadId` 回调（或 `onThreadIdChange`，**以安装版本 TS 类型为准二选一生效**，research R1 实现注意）→ `setThreadId(roleId, id)` 落库；`assistantId`/`apiUrl` 与根 runtime 相同（同一 talk_agent graph，隔离由 thread_id 天然保证）；注入 `adapters: { dictation: serverDictationAdapter }`（模块级单例跨实例复用，research R7；FR-008 语音输入角色页生效）。**实现修订（实测 0.0.32 源码）**：受控 `threadId` 未被 useStreamRuntime 转发（内部以 externalId 覆盖）→ 附着既有线程改为挂载后 `runtime.threads.switchToThread(persistedId)` + 自定义 `unstable_threadListAdapter`（fetch 恒回常规槽、initialize 回带持久化 id、generateTitle 空流）；`onThreadIdChange`（仅此参数存在）落库；**本组件必须渲染在根 provider 之外**（nesting 检测降级 no-op → 串扰，见 T012）
- [x] T010 [P] [US2] 新建 `frontend/components/role-opening.tsx`：Thread `components.Welcome` 覆盖组件（research R6；thread.aui.tsx L74 `Welcome?: ComponentType` 覆盖点）。渲染角色大头像（`catalog.avatar`，MVP 首字母圆形放大态）+ 开场白气泡（`catalog.opening`，Lisa 必须为 spec 原文）；挂载条件天然 = 线程无消息（官方 Welcome 即 `isNewChatView`）→ 首次进入必见（FR-006）、首条用户消息后随 Welcome 自动卸载；开场白为纯配置渲染，**不写入线程历史**（无开场白残留、无重复展示）；推荐回复 chips 本阶段不含（US3 T015 加入）；catalog 条目经 props 传入
- [x] T011 [US2] 新建 `frontend/components/role-chat-page.tsx`（依赖 T009/T010）：角色对话页壳（对照原型图 3）。顶部：返回箭头（props `onBack` → 消息页）+ 右侧音量/设置图标（静态展示、点击无行为不报错，同 001 FR-010 处理），无标题栏（图 3 从原型图）。**FR-011 兜底**：`getRole(roleId)` 为 undefined 或 `avatar`/`opening` 字段缺失 → 渲染"该角色暂时无法使用"空态 + 返回按钮，不白屏不悬挂。正常路径：`<RoleAssistant roleId>` 内渲染 `<Thread components={{ Welcome: RoleOpening }} />`（消息流 + Composer 原样复用）+ `<InterruptPrompt />`（HITL respond 协议原样）+ `<AutoContinue />`（talk-flow.tsx）；**不渲染** NewDialogButton 与选场景按钮（图 3 无此二按钮，research R7）。错误兜底：`useLangChainError()` 在头部下方渲染轻量错误条（重试 = 返回消息页再进入 remount 自动重附着，research R8）。**元数据快照接线**：mount 调 `enterRole(roleId)`（角标清除，FR-004）、unmount 调 `leaveRole` 快照（该角色最后一条消息/时间戳/isRunning → hasNewActivity，research R4）。**实现修订**：R7 假设"Thread 自带 Composer"与现状不符（唯一输入面是 InterruptPrompt），空线程无 interrupt 时无发首条消息通道 → 新增 `RoleStartButton`（仅空线程渲染 NewDialogButton，消息出现后隐藏；US3 chips 接入后可再议去留，quickstart 2.3 依赖）
- [x] T012 [US2] 修改 `frontend/components/main-tab-shell.tsx`（依赖 T011）：补全 route=role 分支——全屏渲染 `<RoleChatPage roleId onBack={() => setRoute({name:"messages"})} />`，TabBar 不渲染（原型图 3）；MessagesPage `onSelectRole` 分发补全：`id === MAIN_ROLE_ID` → tabs（T007 已有）、其他 → `setRoute({name:"role", roleId})`（FR-005/FR-012；data-model §4 状态转移：`messages --点击角色(其他)--> role --返回--> messages`）。**实现修订（架构）**：角色级 useStreamRuntime 不允许嵌套在根 provider 内（0.0.32 nesting 检测降级 no-op → 绑定宿主线程串扰），且根 provider 卸载会连带销毁其内部托管的 useStream 实例（Ella 状态丢失）→ ShellRoute 状态上移至 `app/assistant.tsx`，角色树与根 provider 树互斥兄弟渲染（role 时根 provider 保留挂载、仅卸载 shell 内容）；main-tab-shell 改为接收 `route/onRouteChange` props，role 分支由 app/assistant.tsx 处理
- [x] T013 [US2] 手动验证 US2（依赖 T012）：对照 quickstart.md 2.1–2.9（Lisa 2 秒内进入 = SC-002、顶部返回+音量/设置无标题栏、大头像+开场白 spec 原文+输入区与主界面一致 = FR-008、发消息对话继续且开场白消失、双角色历史互不串扰、3 角色往返 100% 保留 = SC-003、回复进行中切走切回 join-rejoin 内容不丢 = quickstart 2.6、HITL 停留切走切回 InterruptPrompt 正常、点 Ella 直接回主对话、F5 刷新后角色历史仍在）+ spec US2 验收场景 1–5

**Checkpoint**: User Stories 1+2 均可用：完整切换链路（主对话 ⇄ 消息页 ⇄ 角色页）+ 会话隔离与恢复

---

## Phase 5: User Story 3 - AI 消息的推荐回复 (Priority: P3)

**Goal**: 开场白下方展示带语域风格标签（简单/商务）的推荐回复胶囊，点击即作为用户消息发送；对话进行中的推荐回复读取后端 state key（本期降级不实现，后端未返回时不展示不阻塞）

**Independent Test**: 进入任一角色 → 观察开场白下方推荐回复展示 → 点击其中一条 → 确认消息发出并出现在对话流（spec US3 独立测试）

### Implementation for User Story 3

- [x] T014 [P] [US3] 新建 `frontend/components/recommended-replies.aui.tsx`：推荐回复渲染器，一个文件两个导出（research R5；[contracts/recommended-replies.md](../contracts/recommended-replies.md) §2.3 渲染规则）。① `RecommendedReplies({ replies: { label: string; text: string }[] })`：每条渲染 `<ThreadPrimitive.Suggestion prompt={text} send>`（官方原语，点击即作为用户消息发送、`label` 不进入消息正文，FR-009）；视觉 = 白底圆角胶囊行 + "标签: 文案"前缀（对照图 1/图 3："简单: …"/"商务: …"），单行截断、多 chips 纵向堆叠；条件隐藏 = 线程 `isRunning` 或存在挂起 interrupt 时用 `AuiIf` 隐藏（点击发送走 submit 通道，与 HITL respond 通道互斥，research R5）。② `AssistantSuggestions`（来源 B 读取组件）：`useLangChainState<{ label: string; text: string }[]>("suggestions", [])`（官方签名，contracts §2.1）读取后端 state key；非空时渲染 `<RecommendedReplies replies={replies} />`；空数组/后端未实现 → **不渲染任何占位**（FR-010 降级即默认态、无痕）。**实现修订**：隐藏判定未用 `AuiIf`（AssistantState 中 interrupt 形态未验证），改用 talk-flow/interrupt-prompt 已验证的 hook 语义（`useLangChainStream().isLoading` + `useLangChainInterruptState()`），行为等价（isRunning/interrupt 时隐藏）
- [x] T015 [US3] 修改 `frontend/components/role-opening.tsx`（依赖 T014）：开场白气泡下方渲染 `<RecommendedReplies replies={entry.openingSuggestions} />`（来源 A，FR-010 前半；`openingSuggestions` 长度 0 时该角色不渲染 chips、不留空位；contracts/role-catalog §3 消费规则）
- [x] T016 [US3] 修改 `frontend/components/thread.aui.tsx`（依赖 T014，**依赖其稳定后再动此共享文件**）：`ThreadComponents` 类型增加可选插槽 `AssistantSuggestions`，在**最后一条** assistant 消息气泡下方渲染（`useAuiState((s) => s.message.index === s.thread.messages.length - 1)` 判定最后一条；线程空闲的隐藏由插槽内部 RecommendedReplies 的 isLoading/interrupt 判定承担）；**红线已守：渲染由 `AssistantSuggestionsSlot && isLastMessage` 双重守卫，不传该插槽时零渲染、行为与现状完全一致**（主界面零回归）
- [x] T017 [P] [US3] 修改 `frontend/components/main-chat-page.tsx` 与 `frontend/components/role-chat-page.tsx`（依赖 T016）：两处 `<Thread components={...}>` 均传入 `AssistantSuggestions`（插槽传入后主/角色页同样生效，对照图 1 主界面 AI 消息下亦有 chips；本期后端未返回 → 空渲染无痕，quickstart 3.3 降级验证）。附带修复：main-chat-page 顶栏头像改用提取变量 `mainAvatar` 完成 union 类型收窄（判别不能跨两次 getRole 调用，修复 tsc TS2339）。**冒烟排障修订**：role-chat-page 内层 `RoleAssistant`（T011 遗留的双重包装）已移除 —— 实测 0.0.32 源码 `useRemoteThreadListRuntime` 嵌套时（`allowNesting: true`）直接调用 runtimeHook，内层会用**外层作用域当前线程**重建一个 useStream runtime 再套一层 provider，产生双 useStream 实例竞态（表现：Lisa 角色页 Welcome 不渲染/chips 不出现）；单层挂载（RoleAssistant 仅在 app/assistant.tsx 外层）后浏览器冒烟 5/5 PASS（Mira 全新角色：chips 渲染 + 点击发送 + loading 时隐藏）
- [x] T018 [US3] 手动验证 US3（依赖 T015/T017）：对照 quickstart.md 3.1–3.5（开场白下方两条带标签胶囊 = US3-1、点击即作为用户消息出现在对话流并触发回复 = SC-004/US3-2 且标签不入正文、对话进行中无推荐区且收发完全正常 = FR-010 降级、推荐展示时键盘/语音输入照常可用 = US3-4、后端实现 `suggestions` 后的回归项知悉即可）+ spec US3 验收场景 1–4。**实现期间排障记录（2026-10-26，用户报告 Lisa 页报错）**：① 用户 Lisa 线程停在 coach_reply_subgraph 的 HITL 中断点，子图内中断不上浮到根 state（`tasks[].interrupts=[]`）→ 前端 interrupt 守卫失效；② AutoContinue 在进入页面水合历史时因 join 失败 run 的 isLoading 竞态打开门控，对停在图中的线程发 `submit({})` → 后端 resume 时 `HumanMessage(content=null)` ValidationError（后端鲁棒性缺口，**团队后端范围**）；③ 已修：AutoContinue 增加「本会话内观察到过 run」+「挂载后 3s 水合窗口」双守卫；RoleErrorBar 增加错误时效判定（SDK stream.error 在成功 run 后不清除，错误出现后消息有新进展即隐藏）+ 文案改为「可直接继续对话」；④ 已验证：Lisa 页静置零自动触发、底部回复框正常续聊（用户消息 + AI 回复）、Mira 芯片消息 run 服务端 success——chips 收发链路本身无问题
  - **外显预览根因修订（2026-10-27，用户报告"新的应答没显示在消息页"）**：真根因不是此前怀疑的异步 join 竞态，而是后端图每轮收尾写 `SystemMessage("")` 气泡分隔符（talk_graph.py 的 tutor_reply_message_node / polisher_reply_message_node / coach_reply_subgraph）→ 完整对话轮结束后 messages 最后一条恒为空系统消息 → leaveRole 取最后一条提取文本必得空串 → lastPreview="" 回落开场白。修复：main-chat-page 新增 `lastPreviewText()`（从后往前取第一条非空文本消息），主/角色页 leaveRole 统一改用；浏览器 agent 端到端复验 PASS（Ella 行外显 = 教练新话题文本）。注意 `has_no_issue` 分支图会停在 audio_choice_node 的 yes/no 中断、润色反馈在回答后才写 messages——此刻外显用户消息是正确语义，非 bug
  - **角色人设串台修复（2026-10-27，用户报告 Lisa 页出现"我是雅思口语考官"）**：后端教练人设是全局单例 Store（coach_context.py 命名空间 ("coach_context",) key "current"，跨线程共享），前端 12 角色共用同一 talk_agent graph，主对话场景轮换写入的人设被角色页新话题读到（场景轮换序列含 雅思口语考官/Part 1 面试）。用户选定前端映射方案：新增 lib/backend-persona.ts（ROLE_PERSONAS 映射 + ensureBackendPersona 经 langgraph dev Store REST API PUT /store/items 直写，请求串行队列）；角色页（role-assistant）/主对话页（main-chat-page）挂载时各写本页人设双向防串台；role-thread-store 新增 lastMainPersona 持久化字段（scene-applier 应用场景成功后记录，主对话页挂载还原用户所选场景，缺省 英语口语教练/日常闲聊）；NewDialogButton 增加 persona/contextCommand props（点击前 await 确保写入；角色页"新会话"改 respond `_set_context_::<role>::<scenario>` 保持本角色人设，主对话仍 _new_context_ 轮换）。验证：REST 直写 Store → 新线程起跑话题 = "我是英语纠错官，当前对话场景是「中文纠错润色陪练」"✓；agent 浏览器两目录挂载写入实测 ✓。已知取舍：主对话 _new_context_ 轮换结果不跨页保留（回主对话回落上次弹窗场景/缺省）；langgraph dev 重启清内存 Store（下次页面挂载自动重写，自愈）；agent 浏览器中发现 stale interrupt 下 /commands 200 但不起 run（既有点击路径问题，已在前端反馈清单）
  - **人设写入失败中止 + 新会话新线程重启（2026-10-28，用户报告 Trae 预览 Lisa 页点"新会话"仍出错话题）**：① 后端 langgraph dev 重启清内存 Store + 用户点击抢在挂载兜底写入之前 → run 读缺省人设（英语口语教练）出错误话题；暴露 PUT 失败静默缺陷 → 修复：NewDialogButton 的 `handleClick` await `ensureBackendPersona` 结果，失败时**中止发指令**、按钮文案变"人设同步失败，点按重试"；② 后端 `continue_dialog_node` 存在 `raw_text=None` 空输入防御缺失（checkpoint 持久 `new_dialog=False` 的死 interrupt/END 线程上，respond 与 `submit({})` 均会触发后端 ValidationError 使 run 必炸，实测复现；**团队后端范围**：建议 `state.get("raw_text") or NEW_COACH_DIALOG_START` 兜底）→ 前端绕开：NewDialogButton 新增 `viaNewThread` prop（仅角色页传入），此类线程点击"新会话"改为 `aui.threads.switchToNewThread()` 切全新线程（`new_dialog` 默认 true → `new_dialog_node` 固定开场 + Store 人设保证），空线程确认后 effect 自动补发首轮 run；主对话不传该 prop，001 行为零变化。③ interrupt-prompt 早已含 stale interrupt 自动重试（旧 interrupt 重放报 already-consumed → 1s 后以最新状态重试，2026-10-27 修复）；SDK hook 修正：0.0.32 无 `useThreadRuntime` 导出，改用 `useAui`（@assistant-ui/react 顶层导出）。tsc（改动文件零错误）+ oxlint/oxfmt 全绿

**Checkpoint**: 全部用户故事完成：切换链路 + 会话隔离 + 推荐回复（开场白来源可用、后端来源降级待接）

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 跨故事收尾

- [x] T019 [P] 代码清理与 lint：`frontend/` `pnpm lint`（oxlint + oxfmt --check）零错误；移除未用导出/死代码；确认无残留调试输出
  - 完成记录（2026-10-27）：oxlint 0 warnings/errors（46 文件 96 规则）+ oxfmt --check 全通过（54 文件）；调试残留排查（console.log/debugger/RR-DEBUG 于 components/lib/app/hooks）零命中；源码级 tsc 零错误（含此前 tool-fallback `dismissible` 存量错误，报错仅剩 `.next/dev` 生成产物，不影响 lint/构建）
  - 重要发现：42 个"格式漂移文件"是行尾幻影——oxfmt 默认 endOfLine=lf 判 CRLF 为格式错误，而 `core.autocrlf=true` 使 checkout 写出 CRLF，文件内容实际零改动（git diff 为空）。已跑 `pnpm format:fix` 把工作区统一为 LF；防复发经用户确认新增 `frontend/.gitattributes`（`* text=auto eol=lf`），checkout 验证已产出 LF，lint 假红从 git 层面关闭
- [x] T020 全量执行 quickstart.md 验收（依赖 T019，lint 零错误是验收项）：前置条件 → 启动 → 故事 1（1.1–1.7）→ 故事 2（2.1–2.9）→ 故事 3（3.1–3.5）→ UI 比对（U.1–U.4：消息页对照图 2、角色页对照图 3、chips 对照图 1/3、375px 移动端不破版；Constitution 原则 IV，不一致处以原型图为准微调）→ Lint，全部通过即达到 Done 标准

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**：T001/T002 可并行，完成后进入用户故事
- **Foundational (Phase 2)**：依赖 Setup；T003 ∥ T004；**BLOCKS 全部用户故事**
- **US1 (Phase 3)**：依赖 Foundational；T005 ∥ T006 → T007 → T008
- **US2 (Phase 4)**：依赖 US1 完成（消息页落位后才能进入角色）；T009 ∥ T010 → T011 → T012 → T013
- **US3 (Phase 5)**：依赖 US2 完成（角色页壳稳定后再接 chips）；T014 → T015/T016（T016 动共享文件 thread.aui.tsx，须在 T014 提供组件后）→ T017 → T018
- **Polish (Phase 6)**：依赖全部故事完成；T019 → T020

### User Story Dependencies

- **US1 (P1)**：仅依赖 Foundational，无跨故事依赖 🎯 MVP
- **US2 (P2)**：依赖 US1 的消息页与 ShellRoute 落位；复用同一 store 与 T007 已确立的快照接线范式，行为独立可测
- **US3 (P3)**：依赖 US2 的角色页与 thread.aui.tsx 稳定；渲染器为独立新文件，开场白 chips（T015）与插槽（T016/T017）为其仅有的两处接线

### Parallel Opportunities

- Phase 1：T001 ∥ T002
- Phase 2：T003 ∥ T004（不同文件、互不依赖）
- Phase 3：T005 ∥ T006（不同文件）
- Phase 4：T009 ∥ T010（不同文件）
- Phase 5：T017 可拆两文件并行（main-chat-page ∥ role-chat-page）
- Phase 6：T019 可与 T020 准备并行，但 T020 需 T019 完成（lint 零错误是验收项）

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1（T001/T002）+ Phase 2（T003/T004）
2. 完成 Phase 3（US1）→ **STOP and VALIDATE**：quickstart 1.1–1.7 独立验证
3. 此时应用已具备消息入口 → 12 角色列表 → 返回主对话的完整导航环

### Incremental Delivery

1. Setup + Foundational + US1 → MVP（入口与列表可用）
2. + US2 → 角色独立对话与会话隔离（核心切换价值交付）
3. + US3 → 推荐回复（开场白来源可用，后端来源降级待接）
4. Polish → lint 清零 + quickstart 全量通过 → Done

### 红线提醒（贯穿所有阶段）

- 后端零改动：本特性无任何 backend 任务（Constitution 原则 II）
- 消息正文不落前端库：真值在 LangGraph checkpointer，前端只存列表元数据快照（Constitution 原则 III）
- 不替换 `useStreamRuntime` 运行时、不引入 `useRemoteThreadListRuntime`（research R1 拒绝方案）
- 每个样式决策以原型图为准，目视比对收尾（Constitution 原则 IV）
- thread.aui.tsx 为共享文件：T016 是其唯一改动点（可选插槽），不传时行为必须与现状完全一致

## Notes

- [P] 任务 = 不同文件、无未完成依赖
- 每个 US 的手动验证任务（T008/T013/T018/T020）是硬性 Checkpoint，未通过不进入下一阶段
- 提交节奏：每任务或逻辑组完成后 commit
- 已知限制（research R8，验收时知悉即可）：后端重启会清 in-memory checkpointer → 持久化 threadId 失效表现为空线程 + 开场白（首次进入观感），下次发送自愈；隐私模式 localStorage 不可用 → 元数据降级内存态
- 避免：模糊任务、同文件并行冲突（T007/T012 同文件已按阶段排序、T015/T016 依赖 T014 已显式排序）、破坏故事独立性的跨故事依赖
