# Research: 切换对话角色与推荐回复

**Branch**: `003-switch-conversation-role` | **Date**: 2026-10-26
**原型图**: `frontend/docs/mockups/子功能-切换对话role.png`（图1 入口+推荐回复、图2 消息列表、图3 角色对话页）

本文件解决 spec 中全部技术未知项。每项给出**决策 / 依据 / 备选方案（含拒绝理由）**。查证来源：assistant-ui MCP（mcp_assistant-ui，/docs/runtimes/langchain、/docs/runtimes/concepts/threads、/docs/primitives/suggestion）与 LangChain 官方文档（docs.langchain.com frontend join-rejoin）。

---

## R1. 12 个角色的会话如何隔离？（核心决策）

**决策**: **每角色一条独立 LangGraph 线程 + `useStreamRuntime` 受控 `threadId` 挂载**。

> **实现修订（tasks.md T009，2026-10-27）**：实测 `useStreamRuntime` 的受控 `threadId` 未被转发到线程层（内部以 externalId 为准）→ 附着既有线程改为挂载后 `runtime.threads.switchToThread(persistedId)` + `unstable_threadListAdapter`（下述被拒备选的轻量子集：仅 fetch/initialize/generateTitle，list 恒空、其余 no-op，线程清单由 role-thread-store 承担）；线程 id 经 `onThreadIdChange` 落库。

- 前端为每个角色持久化 `roleId → threadId` 映射（zustand persist → localStorage，见 R4）。
- 角色对话页挂载自己的 `AssistantRuntimeProvider`：`useStreamRuntime({ assistantId, apiUrl, threadId, onThreadId })`。
  - 首次进入：`threadId` 为空 → 首次发送时 `useStream` 自动建线，`onThreadId(id)` 回调落库；
  - 再次进入：以持久化的 `threadId` 挂载 → runtime 从 LangGraph Server（checkpointer）拉取该线程历史。
- **切走再回来的可靠性**：LangChain 官方 join-rejoin 文档明确——*"When the component remounts with the same thread ID, the stream attaches to the thread's current state and any in-flight run"*。即组件卸载期间 run 在服务端继续执行，重新挂载后自动附着线程当前状态与进行中的 run。这直接满足 spec 边界用例"对话进行中切换到消息页再返回：内容与进行中状态保持原样"。
- **TalkAI助教Ella = 主对话线程**（spec Assumption）：根 `AssistantRuntimeProvider`（app/assistant.tsx）挂在 Shell 之上**永不卸载**，主对话天然隔离且切换零成本；消息页点击 Ella = 返回主对话视图，不新建实例。

**依据**:
- `/docs/runtimes/langchain`：`useStreamRuntime` "accepts every option upstream `useStream` does"；`onThreadIdChange`/`threadId` 为受控挂载入口；`thread.isLoading` 反映历史拉取。
- docs.langchain.com `oss/python/langchain/frontend/join-rejoin`：受控 `threadId` + `onThreadId(id)` 持久化是官方推荐模式，remount 附着当前状态与 in-flight run。
- 同一 graph（talk_agent）对不同 thread 天然状态隔离（checkpointer 按 thread_id 存储），零后端改动。

**备选方案（拒绝）**:
- ❌ `useRemoteThreadListRuntime` + 自定义 `RemoteThreadListAdapter`（assistant-ui 多线程"自有数据库"路径）：官方标注 `unstable_threadListAdapter`/unstable 系列 API，契约面大（list/initialize/rename/archive/delete/fetch/generateTitle 全套），且 Ella="当前主线程"的映射在该模型下别扭；违反最小复杂度。
- ❌ `AssistantCloud`：引入托管线程服务与外部依赖，本地 MVP 不需要，违反 Constitution 原则 II/III 精神。
- ❌ Next.js 多路由（/chat/[roleId]）+ 每路由独立 runtime：路由重挂载本身不丢数据（threadId 持久化后可恢复），但引入 URL 语义与 001 已确立的"单页面壳"架构冲突，无深链收益（001 research R5 同理由）。
- ❌ 前端 localStorage 自存消息历史、不走服务端线程：消息重复存储、与 graph 状态（interrupt/checkpoint）脱节，HITL resume 无法工作；拒绝。

**实现注意**：
- `useStreamRuntime` 选项表同时列出上游 `onThreadId` 与 assistant-ui 侧 `onThreadIdChange`；实现时以安装版本的 TS 类型为准（二选一生效，语义相同），tasks 阶段确认。
- 角色页与主页面共用同一 `assistantId`（`NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID`，即 talk_agent graph）。

---

## R2. 消息页 / 角色对话页的导航结构？

**决策**: **MainTabShell 内组件级 route 切换，子页面全屏并隐藏 TabBar**。

- `MainTabShell` 持有 `route: { name: "tabs" } | { name: "messages" } | { name: "role"; roleId: string }`。
- `route = tabs`：现有三 Tab 壳原样（TabBar 可见）；`MainChatPage` 左上角消息图标升级为按钮 → `setRoute({ name: "messages" })`。
- `route = messages`：全屏渲染 `<MessagesPage />`（返回箭头 → tabs）；TabBar 不渲染（对照原型图 2：无底部 Tab）。
- `route = role`：全屏渲染 `<RoleChatPage roleId />`（返回箭头 → messages，符合图2→图3 往返动线；FR-012 经由消息页换角色能力保留）；TabBar 不渲染（对照原型图 3）。

**依据**: 001 research R5 已确立"单页面组件级切换、provider 不卸载"模式；原型图 2/3 均为无底部 Tab 的全屏页面（push 式导航观感）；根 runtime 在 Shell 之上，`tabs` 视图随 route 切换卸载/重挂**不影响**主对话（runtime 状态驻留 provider，重挂仅重绑视图）。

**备选方案（拒绝）**:
- ❌ 消息页作为 Tab1 内的第三视图、保留 TabBar：与原型图 2 不符（图 2 无底部 Tab）。
- ❌ 保持 TabBar 可见的叠加层（popup）形态：原型图为整页列表而非弹层。

**边界核对**（spec FR-002 / Edge Cases）：
- 主对话进行中切到消息页/角色页：根 runtime 不卸载，run 持续在 provider 内流动；返回 tabs 后 `Thread`/`InterruptPrompt` 重绑即见最新状态（含 interrupt）。
- `AutoContinue` 随 MainChatPage 卸载：离开期间图跑到 END 后**不会**自动发起下一轮（组件不在）；返回后恢复自动续跑。行为定义记入 quickstart 验证 2.6。
- 反复快速切换（Edge Case）：每角色一个 runtime 实例、互不共享可变状态；route 切换为纯 state 更新，无跨实例写入。

---

## R3. 12 个角色的静态配置放哪、长什么样？

**决策**: 新增 `lib/role-catalog.ts`，纯前端静态常量，**完全照搬 002 `lib/scene-catalog.ts` 范式**（模块级常量、类型导出、消费方只读）。字段：`id / name / avatar / tagline / opening / openingSuggestions`（详见 [contracts/role-catalog.md](./contracts/role-catalog.md)）。

- 12 个角色清单以 spec FR-003 为准（原型图 2 中出现的 FCE英国中学生Bella、职场会议实战教练Linda 不在本期清单内，以 spec 为准；视觉样式以原型图为准）。
- 开场白：Lisa 的文案取自 spec FR-006 原文；其余角色按其身份合理拟定（与 002 "其余条目实现时拟定、用户可随时替换"同一策略）。
- 首轮推荐回复：每角色 2 条（简单/商务各一），标签+文案按角色身份拟定，用户可随时改静态数据。
- 头像：配置支持图片路径（`public/avatars/*.png`）与首字母圆形两种形态；MVP 先以内置首字母圆形交付，图片资源落位后仅改配置即可切换（不影响任何逻辑）。

**依据**: 002 已验证"静态数据契约 + 弹窗/UI 零耦合"模式在本仓库可维护；FR-006 要求开场白为配置数据不依赖现场生成。

**备选方案（拒绝）**:
- ❌ 后端下发角色目录：FR-003 明确 MVP 前端内置、零后端改动。
- ❌ 角色配置内嵌组件文件（tsx）：配置与渲染耦合，替换数据要动代码；拒绝。

---

## R4. 会话列表的预览/时间戳/未读角标数据从哪来？

**决策**: 新增 `lib/role-thread-store.ts`（zustand + `persist` 中间件 → localStorage），每角色一条元数据：

```ts
{ roleId, threadId: string | null, lastPreview: string, lastActivityAt: number | null, unreadCount: number }
```

更新时机（唯一写入方 = 页面壳组件的生命周期回调，运行时不主动写）：

| 事件 | 动作 |
|------|------|
| 进入任一对话页（主/角色） | 该角色 `unreadCount = 0`（FR-004 角标清除） |
| 离开任一对话页 | 快照该角色当前最后一条消息为 `lastPreview`（截断 ~60 字符）、`lastActivityAt = Date.now()`；若离开时 `thread.isRunning` 或存在未消费的新消息 → `unreadCount += 1`（预期回复在离开后送达） |
| 首次建线 | `onThreadId` 写入 `threadId` |
| 从未进入过的角色 | 无记录 → 预览显示开场白摘要、时间戳显示 "—"、无角标（spec Edge Case） |

- 列表排序：有活跃记录的按 `lastActivityAt` 降序（对照原型图 2 顶部为最近活跃），无记录的按配置顺序垫底。
- 时间戳格式：当天 HH:MM，非当天 MM-DD（对照原型图 2 的 HH:MM 样式）。

**依据**: 未读与预览是纯展示派生数据（Constitution 原则 III：视图层转换优先）；MVP 单用户本地使用，localStorage 足够；"未读"的精确语义（服务端推送级）不属于 MVP 范围，规则以上表为准并在 quickstart 验证。

**备选方案（拒绝）**:
- ❌ 消息页打开时逐线程拉取 12 条线程历史再计算预览/未读：12 次网络请求换取不必要精度，消息页秒开目标（SC-001）受损；且"离线期间的到达消息"本来也只在重新附着时可见，快照规则已覆盖 spec 全部验收场景。
- ❌ 精确按"离开后新到消息条数"计未读：需要后台保持 12 个 stream 订阅，成本与收益不匹配；`+= 1` 的"有新动静"语义满足 FR-004（有角标、进入清除）。

---

## R5. 推荐回复（chips）如何渲染与发送？

**决策**: 官方 **`ThreadPrimitive.Suggestion`（`send`，直接传 `prompt` prop）** 渲染点击即发送的胶囊；官方文档明确该形态用于"渲染调用方已持有的 prompt"（不依赖 runtime suggestions 配置）。

- **渲染器**：`components/recommended-replies.aui.tsx` —— `RecommendedReplies({ replies: { label, text }[] })`，每条渲染 `<ThreadPrimitive.Suggestion prompt={text} send>`，视觉为"标签前缀 + 文案"胶囊（对照图1/图3："简单: …"/"商务: …"白底圆角行）。运行中/interrupt 挂起时用 `AuiIf` 隐藏（点击发送走 submit 通道，与 HITL 的 respond 通道互斥，避免打断恢复流程）。
- **来源一（开场白首轮，FR-010 前半）**：角色配置 `openingSuggestions`，在开场白气泡下方渲染（见 R6）。
- **来源二（对话进行中，FR-010 后半）**：读取后端 state key `suggestions`（`useLangChainState<RecommendedReply[]>("suggestions", [])`，官方"Reading custom state keys"能力），非空时渲染在**最后一条** assistant 消息气泡下方；为空/未实现 → 不渲染、不影响收发（**降级即默认态**，本期后端零改动）。
- **放置点**：`thread.aui.tsx` 的 `ThreadComponents` 增加可选插槽 `AssistantSuggestions`，在 assistant 消息气泡之下渲染（仅最后一条 assistant 消息且线程空闲时；不传该插槽时组件行为与现状完全一致——主界面零影响，传入后主/角色页同样生效，对照图1 主界面亦有 chips）。

**依据**: `/docs/primitives/suggestion`（Trigger `send` 语义、直接 prompt 形态、`AuiIf` 条件渲染）；`/docs/runtimes/langchain`（`useLangChainState<T>(key, defaultValue)` 官方签名）；原型图 1/3 的 chips 视觉。

**备选方案（拒绝）**:
- ❌ 静态 suggestions 配置（runtime 级 `Suggestions(...)`）：作用于整线程而非"每条 AI 消息下方"，且开场白后需要动态清空，复杂度更高；`ThreadPrimitive.Suggestions` 迭代 `thread.suggestions` 的形态适合"欢迎屏"，不适合本需求的贴消息胶囊。
- ❌ 手写按钮 + `useAui().thread.append()` 直接发送：绕开官方 `Suggestion` 的发送门控（isSendDisabled/队列/语音会话态），违反 Constitution 原则 I。
- ❌ 每条历史消息都显示各自的 chips：需要后端 per-message 元数据支持，超出 MVP；线程级 `suggestions` state 只反映最新一轮，因此只渲染在最后一条 AI 消息下方（FR-009"支持展示"以该能力满足，契约演进预留见 contracts/recommended-replies.md）。

---

## R6. 开场白如何展示、何时消失？

**决策**: 复用 `Thread` 既有 **`components.Welcome` 覆盖点**（thread.aui.tsx 已内建，`ThreadComponents.Welcome`）：角色页传入 `RoleOpening` 组件 —— 大头像（角色配置 avatar）+ 开场白气泡（角色配置 opening）+ 首轮推荐回复 chips。

- 展示条件 = 线程无消息（官方 Welcome 挂载条件即 `isNewChatView`）→ 首次进入必见（FR-006）。
- 消失时机 = 用户发出第一条消息（Welcome 随线程非空自动卸载）。开场白是纯前端渲染的配置数据，**不写入线程历史**；此后再次进入直接看到真实对话历史（无开场白残留，无重复展示）。
- 大头像随 Welcome 仅在空线程展示（对照图 3 初始态）；对话开始后顶部栏保持"返回 + 音量/设置"（图 3 无标题栏，从原型图）。

**依据**: thread.aui.tsx L74 `Welcome?: ComponentType` 覆盖点 + L181 `<AuiIf condition={isNewChatView}><Welcome /></AuiIf>`；FR-006"开场白是配置数据，MUST NOT 依赖现场生成"。

**备选方案（拒绝）**:
- ❌ 开场白作为 assistant 消息注入线程（submit 一条伪消息或前端拼接）：污染线程历史、与后端 checkpointer 状态不一致、恢复历史时要额外过滤；拒绝。
- ❌ 本地标记 `openingShown` 持久化 + 历史上方永久渲染伪气泡：多一份持久化状态且与线程状态可能不一致；Welcome 机制天然覆盖"首次见、发送后消失"。

---

## R7. 角色对话页的输入区/工具如何与主界面保持一致？（FR-008）

**决策**: 角色对话页直接复用既有组件，不新写输入面：

| 能力 | 复用组件 | 差异 |
|------|---------|------|
| 消息流 + Composer + 语音输入 | `Thread`（thread.aui.tsx，含 dictation/Dictate） | 仅 `components.Welcome` 覆盖为角色开场白（R6） |
| HITL 回复 | `InterruptPrompt`（respond 协议） | 原样 |
| 自动续跑 | `AutoContinue`（talk-flow.tsx） | 原样 |
| 新会话 / 选场景按钮 | 不渲染 | 图 3 角色页无此二按钮；002 场景指令作用于主对话线程，角色页 MVP 不提供（超范围） |

- 角色 runtime 实例同样注入 `adapters: { dictation: serverDictationAdapter }`（模块级单例，一次只有一个活跃会话，跨实例复用安全）。

**依据**: FR-008"输入区与底部工具栏与主对话界面保持一致"；图 3 输入区与主界面同构（点击说话 + 键盘/电话图标，001 已实现同构样式）。

---

## R8. 失败与边界兜底

- **角色页运行错误**（网络断、线程拉取失败）：`useLangChainError()` 在角色页头部下方渲染轻量错误条（重试 = 返回消息页再进入，remount 自动重附着）；不阻塞返回操作。
- **角色配置缺失/渲染异常**（FR-011）：`RoleChatPage` 对 `role-catalog` 查找失败或 avatar/opening 字段异常时渲染"该角色暂时无法使用"空态 + 返回按钮，不白屏。
- **推荐回复点击时网络异常**（spec Edge Case）：`ThreadPrimitive.Suggestion send` 走标准发送通道，失败呈现与普通消息发送一致的错误表现（消息区错误条/状态），页面不中断。
- **localStorage 不可用**（隐私模式）：zustand persist 降级为内存态——会话线程映射丢失导致角色历史需要重建，但不崩溃；quickstart 备注该已知限制（MVP 可接受）。
- **threadId 失效**（后端重启导致 in-memory checkpointer 清空）：以持久化 threadId 挂载拉取 404/空历史 → 角色页表现为空线程 + 开场白（首次进入观感），下次发送服务端按新线程处理；不做主动清理（低成本自愈）。
