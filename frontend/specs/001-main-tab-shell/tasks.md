---
description: "Tasks for 001-main-tab-shell feature implementation"
---

# Tasks: 自由对话主窗口与三 Tab 主框架

**Input**: Design documents from `frontend/specs/001-main-tab-shell/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/audio-transcribe.md, quickstart.md

**原型图（唯一视觉基准，Constitution 原则 IV）**: `frontend/docs/mockups/自由对话主窗口_所有其他子功能布局根据这个来-不要参考子功能的布局.png`

**Tests**: 前端无自动化测试框架（package.json 无 test script），以 quickstart.md 手动验证为唯一验收手段；后端转写端点按契约做 curl 级自检。未请求自动化测试，故不含测试编写任务。

**Organization**: 按用户故事分组（US1 三 Tab 主框架 → US2 对话能力迁移 → US3 UI 优化 + 语音输入 FR-009），每个故事可独立验证交付。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 对应 spec.md 用户故事（US1/US2/US3）
- 描述含确切文件路径

## Path Conventions

- 前端：`frontend/app/`、`frontend/components/`（assistant-ui 脚手架结构）
- 后端：`backend/src/`（LangGraph Server，仅新增 webapp.py + langgraph.json 一行配置）

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 环境就绪确认与迁移前行为基线记录

- [X] T001 [P] 确认前端环境：在 `frontend/` 执行 `pnpm install` 并 `pnpm dev` 启动成功（localhost:3000）；记录现有单页对话行为基线（新会话、发送消息、HITL 回复、AutoContinue、消息渲染各一步的操作结果，作为 US2 "与迁移前一致" 的对照基准，对应 spec US2 独立测试）
- [X] T002 [P] 确认后端环境：`backend/.env` 含 `XF_APP_ID` / `XF_API_KEY` / `XF_API_SECRET`；`backend/` 执行 `uv sync` 后 `uv run langgraph dev` 启动成功（Server started at http://localhost:2024）

**Checkpoint**: 前后端均可启动，迁移前基线已记录

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 跨故事阻塞前置项

**无任务**——仓库已有完整可运行的单页对话与同源代理（`frontend/app/api/[_path]/route.ts`），无跨故事共享的新基础设施需要先行搭建。后端转写端点仅服务 US3（语音输入），按"故事特定设置"规则置于 US3 阶段内。

**Checkpoint**: 无阻塞项，可直接进入用户故事

---

## Phase 3: User Story 1 - 三 Tab 主框架与主页面入口 (Priority: P1) 🎯 MVP

**Goal**: 打开应用即进入主窗口：底部三个 Tab（自由对话 / 精讲课对话 / 我的），默认选中第一个并展示主对话页面，另两个为空占位页；Tab 切换不丢失对话状态

**Independent Test**: 打开应用观察 Tab 栏与默认页面，依次点击三个 Tab 观察切换结果（spec US1 验收场景 1–3）

### Implementation for User Story 1

- [X] T003 [P] [US1] 新建 `frontend/components/tab-bar.tsx`：底部 TabBar 组件，模块级静态 `TabConfig[]` 常量（`id: "chat" | "tab2" | "tab3"`、`label` 按原型图文案、`icon` 用 lucide-react 图标，3 项固定顺序 chat 首位，见 data-model.md TabConfig）；激活态由 props 传入的 activeTab 控制（本阶段保证结构与切换可用，视觉细节在 US3 对齐原型图）
- [X] T004 [P] [US1] 新建 `frontend/components/empty-tab.tsx`：空占位页组件（静态展示，无任何交互元素与副作用，可被 tab2/tab3 复用；FR-003）
- [X] T005 [US1] 新建 `frontend/components/main-chat-page.tsx`：Tab1 主页面骨架——顶部栏占位结构（本阶段仅结构占位，完整样式在 T022 实现）+ 原样嵌入现有 `frontend/components/thread.aui.tsx`（消息流 + Composer，行为不改）
- [X] T006 [US1] 新建 `frontend/components/main-tab-shell.tsx`：client 组件，`useState<TabId>` 管理 activeTab（默认 `"chat"`），内容区按 activeTab 条件渲染 MainChatPage / EmptyTab / EmptyTab，底部渲染 TabBar；切换仅改 state，无路由、无存储副作用（research R5；FR-001/FR-002）
- [X] T007 [US1] 修改 `frontend/app/page.tsx`：移除原单页对话直出结构，改为渲染经 `frontend/app/assistant.tsx` provider 包裹的 `<MainTabShell />`（旧页面内容就此移除，删除时机与 FR-011 最终确认在 T012 复核）
- [X] T008 [US1] 修改 `frontend/app/assistant.tsx`：确认 `AssistantRuntimeProvider` + `useStreamRuntime` 层级包在 MainTabShell 外层（provider 不随 Tab 切换卸载，保证 FR-007 状态保持；plan.md 结构决策）
- [X] T009 [US1] 手动验证 US1：对照 quickstart.md 1.1–1.4（默认选中、三 Tab 切换、反复切换无副作用、切回状态保持；布局为结构层面比对，视觉细节验收在 US3/收尾）+ spec US1 验收场景 1–3

**Checkpoint**: User Story 1 可独立使用：三 Tab 框架可用，Tab1 展示对话页面，切 Tab 状态不丢

---

## Phase 4: User Story 2 - 现有对话能力原样迁移 (Priority: P2)

**Goal**: 创建新对话、HITL 回复、后端实时反应、消息展示在 Tab1 主对话页面中与迁移前行为完全一致；新主框架成为唯一入口

**Independent Test**: 在新主对话页面内执行完整对话流程（新建会话 → 发送消息 → 回复 HITL → 观察后端反应），与 T001 记录的基线逐项对照（spec US2 独立测试）

### Implementation for User Story 2

- [X] T010 [US2] 将 `frontend/components/talk-flow.tsx` 的 `NewDialogButton`（首轮空输入 run）与 `AutoContinue`（run 到 END 自动续跑）接入 `frontend/components/main-chat-page.tsx`：原样迁移、行为不改（research R7 迁移清单）
- [X] T011 [US2] 将 `frontend/components/interrupt-prompt.tsx`（HITL：`useLangChainInterruptState` + `useLangChainRespond`）接入 `frontend/components/main-chat-page.tsx` 常驻区域：原样迁移，恢复必须走 `respond` 路径（`submit(null, {command:{resume}})` 禁用，research R7 红线）
- [X] T012 [US2] 按 research R7 迁移清单逐项核对迁移完整性与行为一致性（对照 T001 基线）；确认 `frontend/app/` 下无残留旧对话入口路由/链接，新主框架为唯一入口（FR-011 最终确认）
- [X] T013 [US2] 手动验证 US2：对照 quickstart.md 2.1–2.6（新对话 → coach 话题 → HITL 回复 → AutoContinue 循环 → 切 Tab 后流/中断状态不丢失）+ spec US2 验收场景 1–3

**Checkpoint**: User Stories 1+2 均可用：对话能力完整保留且行为与迁移前一致

---

## Phase 5: User Story 3 - 主页面 UI 按原型图优化 + 语音输入落地 (Priority: P3)

**Goal**: 按原型图完成视觉优化（主题色、圆角、输入框、顶部栏、Tab 栏、FR-010 静态元素）；实现真实语音输入（FR-009：后端最小转写端点 + 前端 DictationAdapter，单击-单击模式，自动转写直接发送，失败轻提示不断页面）

**Independent Test**: 语音按 quickstart.md 3.1–3.7 验证（SC-005）；UI 与原型图逐区域目视比对（SC-004，Constitution 原则 IV）

### Backend（契约：contracts/audio-transcribe.md；Constitution 原则 II 已确认的最小修改，禁止改 graph/工具函数）

- [X] T014 [P] [US3] 新建 `backend/src/webapp.py`：FastAPI app，`POST /audio/transcribe`，Content-Type `application/octet-stream`，请求体为 raw PCM（16kHz/16bit/单声道/小端）；空体或 <300ms（约 9.6KB）→ 400 `{"detail": "empty audio"}`；调用现有 `xfyun_iat_tool_by_audio_data`（`backend/src/tools/audio_tool/xfyun_ita/xfyun_iat_tool.py`，不改其实现）；成功 200 `{"text": <str>}`，失败 500/502 统一 `{"detail": ...}` 形态；不引入鉴权与重试（契约第 2、3 节）
- [X] T015 [P] [US3] 修改 `backend/langgraph.json`：增加 `"http": { "app": "./src/webapp.py:app" }`；并在 `backend/pyproject.toml` dependencies 显式补一行 `fastapi`（仅声明，research R1）
- [X] T016 [P] [US3] 新建 `frontend/components/server-dictation-adapter.ts`：实现 assistant-ui 官方 `DictationAdapter` 接口（Constitution 原则 I，契约见 research R3）——`getUserMedia` → `AudioContext({ sampleRate: 16000 })`（不支持时回退默认采样率 + 前端线性重采样）→ AudioWorklet（回退 ScriptProcessorNode）收集 Float32 → Int16 PCM；录音时长 <300ms 不上传直接置 ended；`stop()` 合并 Int16 帧为 ArrayBuffer，`fetch("/api/audio/transcribe", { method: "POST", body, headers: { "Content-Type": "application/octet-stream" } })`；成功 emit `{ transcript, isFinal: true }` 后置 ended/stopped；任何失败 emit `ended/error`；`disableInputDuringDictation: false`（research R2/R3/R8）

### Frontend 语音接线

- [X] T017 [US3] 契约级自检（依赖 T014/T015）：`langgraph dev` 重启后，curl 直连 `http://localhost:2024/audio/transcribe` 与经代理 `http://localhost:3000/api/audio/transcribe`，均以 `backend/src/talk_agent/test_resources/iat_pcm_16k.pcm` 为请求体返回 `{"text":"..."}`（quickstart 第 2 节）
- [X] T018 [US3] 修改 `frontend/app/assistant.tsx`：`useStreamRuntime` 注入 `adapters: { dictation: new ServerDictationAdapter() }`（依赖 T016）
- [X] T019 [US3] 修改 `frontend/components/thread.aui.tsx`：Composer 接入 `ComposerPrimitive.Dictate` / `ComposerPrimitive.StopDictation`（按 `composer.dictation` 是否为 null 切换，单击-单击模式）；转写 final 文本由 runtime commit 进 composer 后自动发送（不进输入框确认环节）；失败/空文本时 toast 轻提示（1~2s 自动消失），页面不中断、键盘输入全程可用（FR-009、spec 兜底 A；依赖 T016/T018）
- [ ] T020 [US3] 手动验证语音输入（依赖 T017/T019）：对照 quickstart.md 3.1–3.6（授权、单击-单击、"转写中"态、≤3s 自动发送、键盘并存、后端暂停的失败兜底、<300ms 不发请求）+ SC-005

### UI 按原型图优化（样式改动不改组件行为）

- [X] T021 [P] [US3] 修改 `frontend/app/globals.css`：按原型图采样调整 `--color-primary` / `--color-ring` 等 oklch 主题变量（亮/暗 `.dark` 两套同步）与 `--radius` 数值（FR-006；research R6，禁止引入新 UI 库或硬编码色值）
- [X] T022 [P] [US3] 修改 `frontend/components/main-chat-page.tsx`：顶部栏按原型图完整实现（左侧会话入口图标、居中 AI 对话对象头像与名称 "Ella"、右侧音频与设置图标）+ 底部"新会话 / 选场景"按钮区（`NewDialogButton` 视觉整合入该区；"选场景"及顶部栏无子功能支撑的图标按 FR-010 静态展示、点击无任何行为不报错）（FR-005/FR-010；依赖 T006/T010）
- [X] T023 [P] [US3] 修改 `frontend/components/thread.aui.tsx`（消息气泡圆角/配色、输入框 `--composer-bg` / `--composer-padding` 与占位文案）与 `frontend/components/tab-bar.tsx`（图标、选中态高亮、文字样式）对齐原型图（FR-006；依赖 T019 完成后进行，避免同文件冲突；与 T021/T022 并行）
- [X] T024 [US3] 目视比对（依赖 T021/T022/T023）：主页面与原型图逐区域比对（顶部栏 / 消息区 / 底部控制区 / 输入框 / Tab 栏），不一致处以原型图为准微调（Constitution 原则 IV、SC-004、quickstart U.1–U.5）

**Checkpoint**: 全部用户故事完成：框架 + 迁移 + 语音输入 + 原型图 UI

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 跨故事收尾

- [X] T025 [P] 代码清理与 lint：移除迁移遗留的死代码/未用导出/未用样式；`frontend/` `pnpm lint`（oxlint + oxfmt --check）零错误；`backend/` ruff 检查 `src/webapp.py` 通过
- [ ] T026 全量执行 quickstart.md 验收：前置条件 → 启动 → 契约自检 → 故事 1（1.1–1.4）→ 故事 2（2.1–2.6）→ 故事 3 语音（3.1–3.7）→ UI 比对（U.1–U.5）→ Lint，全部通过即达到 Done 标准

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**：T001/T002 可并行，完成后进入用户故事
- **Foundational (Phase 2)**：无任务，无阻塞
- **US1 (Phase 3)**：依赖 Setup；T003/T004/T005 并行 → T006 → T007/T008 → T009
- **US2 (Phase 4)**：依赖 US1 完成（组件落位后才能接入流程）；T010/T011 可并行 → T012 → T013
- **US3 (Phase 5)**：依赖 US2 完成（Composer/输入区稳定后再接线与改样式）；后端 T014/T015、前端 T016 可并行 → T017/T018/T019 → T020；样式 T021/T022/T023 并行（T023 需 T019 完成）→ T024
- **Polish (Phase 6)**：依赖全部故事完成；T025 → T026

### User Story Dependencies

- **US1 (P1)**：仅依赖 Setup，无跨故事依赖 🎯 MVP
- **US2 (P2)**：依赖 US1 的壳结构落位；行为对照独立可测
- **US3 (P3)**：依赖 US2（对话流稳定）；后端端点任务（T014/T015）本身可提前与 US1/US2 并行（不同目录、无依赖），仅接线任务（T017+）需在 US2 后

### Parallel Opportunities

- Phase 1：T001 ∥ T002
- Phase 3：T003 ∥ T004 ∥ T005
- Phase 4：T010 ∥ T011
- Phase 5：T014 ∥ T015 ∥ T016；T021 ∥ T022 ∥ T023（T023 待 T019 后）
- Phase 6：T025 可与 T026 的准备并行，但 T026 需 T025 完成（lint 零错误是验收项）

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1（T001/T002）
2. 完成 Phase 3（US1）→ **STOP and VALIDATE**：quickstart 1.1–1.3 独立验证
3. 此时应用已具备三 Tab 主入口与可用的对话页面

### Incremental Delivery

1. Setup + US1 → MVP（主框架可用）
2. + US2 → 对话能力完整迁移，旧入口移除（功能对等）
3. + US3 → 语音输入可用 + UI 与原型图一致（视觉验收）
4. Polish → lint 清零 + quickstart 全量通过 → Done

### 红线提醒（贯穿所有阶段）

- 后端仅允许 T014/T015 两处改动；禁止改 graph 结构、节点逻辑、状态定义、`xfyun_iat_tool_by_audio_data`（Constitution 原则 II）
- 不修改后端任何数据结构；前端只做读取展示（Constitution 原则 III）
- 每个样式决策以原型图为准，目视比对收尾（Constitution 原则 IV）

## Notes

- [P] 任务 = 不同文件、无未完成依赖
- 每个 US 的手动验证任务（T009/T013/T020/T024/T026）是硬性 Checkpoint，未通过不进入下一阶段
- 提交节奏：每任务或逻辑组完成后 commit
- 避免：模糊任务、同文件并行冲突（T019/T023 同文件已显式排序）、破坏故事独立性的跨故事依赖

---

## Phase 7: Convergence

**Purpose**: implement 后收敛——用户验收（2026-10-21）发现的两项缺口，来自输入形态变更与新会话语义扩展

- [X] T027 [backend] 适配 `grammar_check_subgraph` 输入解析：`user_input` 支持已转写文本直通（contradicts，用户指示 2026-10-21）。现状：`xfyun_ita_tool_node`（grammar_check_subgraph.py L167-199）与 `xfyun_ise_tool_node`（L224-248）把 `user_input` 无条件当音频文件路径（临时测试方案，节点内 todo 已标注）；前端语音输入后 `user_input` 是讯飞转写文本，被当路径传给 `xfyun_iat_tool_by_audio_file` → 文件不存在异常 → `iat_status=unavailable` → `empty_input` → `grammar_check_fallback_node` → `tutor_reply` 永不出现。改法（graph 结构/状态定义/其他节点零改动，仅两节点输入判定，符合 Constitution 原则 II 例外条款，理由即本条用户指示）：新增共享判定 helper（如 `_is_audio_path(candidate)`：后缀 ∈ {.pcm,.wav,.mp3,.m4a} 且 `os.path.isfile` 为真）——`xfyun_ita_tool_node` 输入优先级调整为 `audio_data`（上游复用）> `user_input` 为音频路径（旧测试通道保留）> `user_input` 非空文本（视为已转写文本，直接 `iat_status="ok", raw_text=user_input`）> 全空时保留原麦克风路径（独立运行子图兼容）；`xfyun_ise_tool_node` 同款判定（非路径 → `no_audio` 短路，不阻塞语法主链路）。验证：后端重启后语音输入一句含语法错误的英文（或 respond 提交文本），链路 `HITL_route → grammar_check_subgraph → has_issue → grammer_tutor_subgraph` 走通，state 出现 `tutor_reply` 并渲染为左侧 AI 消息；再以旧方式 respond 提交 PCM 路径（如 `docs_f/audio/ttsmaker_en2_16k.pcm`）确认测试通道未破坏
- [X] T028 [frontend] `NewDialogButton` 常显 + 双路径（partial，用户指示 2026-10-21）。现状：talk-flow.tsx L32-33 在有消息或停在 HITL 时 `return null`（点击后气泡永久消失），且仅有 `submit({})` 单路径。改法（仅前端，不动后端）：① 移除隐藏条件，气泡常显（`starting`/`stream.isLoading` 时置 disabled 而非消失）；② 双路径分支：线程无消息且无 interrupt（首次）→ `submit({})` 发起首轮 run（后端 `coach_reply_subgraph.is_new_dialog_route` 默认走 `new_dialog_node`，现有逻辑不变）；有历史对话且图停在 HITL（interrupt 存在）→ `useLangChainRespond()` 提交 `"_new_context_"`（respond 协议红线不变，禁止 submit-resume）→ `HITL_route` 走 `new_context_node` 切场景 → END → AutoContinue 自动续跑 → `new_dialog=True` 使下轮走 `new_dialog_node` 出新场景话题（后端闭环自洽，零改动）；run 进行中（isLoading）→ 按钮禁用；文案与白药丸样式保持。验证：首次点击 → coach 出话题且按钮不消失；完成一轮对话后再点 → logger 出现 `new_context_node: ...（下次对话生效）`、AutoContinue 续跑后 coach 用新场景出话题、对话流中不出现 `_new_context_` 字样（HITL_node 已过滤内部指令）

---

## Phase 8: Convergence

**Purpose**: implement 后收敛第二轮——用户验收（2026-10-22）实测发现的三项缺陷：下一轮重复话题、切场景后回复报错、跨轮 AI 消息粘连成一个气泡

- [X] T029 [frontend] 修复下一轮对话重复输出两条 coach 话题（contradicts，US2/AC3 + 用户报告 2026-10-22）。现状：纯文本输入一轮（check 结果正常出现）后，AutoContinue 自动开启的下一轮出现两条默认话题内容；主图每轮 START→store_resolve→coach_reply 线性链路单次 run 只产一条话题（talk_graph.py L148-150），两条话题意味着发生了两次 run；已排除双挂载（AutoContinue 仅在 main-chat-page.tsx L52 一处）。主嫌疑（前端竞态）：AutoContinue（talk-flow.tsx L75-97）useEffect 依赖 stream.isLoading/interrupt/messages，SDK 流重订阅（`net::ERR_ABORTED .../stream/events` 为已知正常现象）或「messages 更新先于 interrupt 状态到达」的窗口期内，effect 在 interrupt 尚未就绪时误判「run 已结束且无挂起」→ 重复 submit({}) 产生第二个 run → 第二条话题。改法：① 先诊断定性——后端 logger 统计单轮内 coach 节点执行次数、浏览器 Network 面板统计 submit({}) 发起的 run 数，确认「前端重复 fire」vs「后端单 run 双写」；② 前端加固 AutoContinue 防重入：fire 后记录当轮最后一条消息 id/长度，未出现新消息前禁止再次 fire（或加 300~500ms settle 延迟等 interrupt 状态稳定后再判定；评估用 stream run 元数据去重），必要时查 assistant-ui react-langchain 官方文档核对流状态生命周期并留档；③ 若诊断为后端单 run 双写：按既有规则排查 coach 子图 add 字段 input_schema 是否需排除父图历史。验证：文本输入 → check 结果 → 下一轮有且只有一条新话题；后端 logger 每轮 coach 节点恰好执行一次；连续多轮文本对话稳定无重复
- [X] T030 [frontend] 修复「新会话(_new_context_)后文本回复报 Unknown or already-consumed interrupt」（contradicts，US2/AC2 + 用户报告 2026-10-22）。现状：首轮 submit({}) 出话题停 interrupt A → 点「新会话」respond("_new_context_") 消费 A → new_context_node → END → AutoContinue submit({}) 新 run 出新场景话题停 interrupt B → 用户输入文本点回复报错「Unknown or already-consumed interrupt: {id}」，回复链路中断（截图：输入框 placeholder 已显示 HITL 提示但 resume 被后端拒绝，说明前端持有的 interrupt 引用与后端实际 pending interrupt 不一致）。主嫌疑（前端 interrupt 状态陈旧/时序）：react-langchain 的 interrupt 状态在旧 interrupt 被消费后、新 run 的 interrupt B 就绪前存在陈旧窗口，SDK 流重订阅可能重放旧 values 使状态回跳。改法：① 查 assistant-ui react-langchain 官方文档（useLangChainInterruptState/useLangChainRespond 生命周期、resume 协议）+ LangGraph Server 对 command.resume 的校验语义，留档依据；② 诊断——Network 面板核对报错请求 payload 与 GET /threads/{tid} 的 pending interrupt 状态；③ 修复保证 respond 只作用于当前有效 interrupt：如新 run 启动（isLoading 变化/run 切换）时清空或屏蔽旧 interrupt 状态、respond 前校验 interrupt 有效性、或采用官方推荐的恢复通道；respond 协议红线不变（禁止 submit-resume）。验证：首轮新对话 → 点新会话 → 新话题 interrupt → 文本回复成功进入 grammar 链 → tutor/polisher 正常收尾；连续两次切场景后回复仍正常
- [X] T031 [backend] coach 话题消息追加空 SystemMessage 分隔，修复两次 AI 回复合并为一个气泡（contradicts，US2/AC3 + 用户报告 2026-10-22；需查官方文档留档）。现状：assistant-ui 转换层把相邻 assistant 消息合并为同一气泡（chunkExternalMessages，useStreamRuntime 固定 joinStrategy=concat-content，前端不可配置）；_new_context_ 路径下 HITL_node 对内部指令不写 HumanMessage（talk_graph.py L54-57），上一轮 coach 话题 AIMessage 与下一轮 coach 话题 AIMessage 相邻 → 粘连成一个气泡（截图：日常闲聊 + Part 1 面试两条话题混在一起）。tutor 链路已有同款解法（tutor_reply_message_node 写 [AIMessage, SystemMessage("")]，talk_graph.py L113-131）。改法：① 查 assistant-ui 官方文档确认消息分组/joinStrategy 行为并留档（用户要求查询官方文档）；② coach_reply_subgraph.py 的 continue_dialog_node（L42-56）与 new_dialog_node（L59-69）返回 messages 改为 [res, SystemMessage(content="")]（与 tutor 范式一致，仅两处返回值，不改 graph 结构；需补 SystemMessage 导入）；③ 若文档揭示前端存在受支持的消息分组配置则优先采用官方方案（前端改动为备选）。验证：新对话话题独立成泡；点新会话切场景后新话题独立成泡、不与上一条粘连；刷新页面后仍保持分离

---

## Phase 9: Convergence

**Purpose**: implement 后收敛第三轮——用户验收（2026-10-22）新增两项反馈：每轮输入（语音/文本）都应有语法反馈消息；AI 回复后出现空白绿气泡

- [X] T032 [backend] has_no_issue 与 check_failed 分支补可见语法反馈消息，保证每轮输入（语音/文本一致）都有反馈（missing，用户报告 2026-10-22）。现状：用户要求每次输入都得到语法检测反馈——has_issue=True 时出 tutor_reply 已正常（grammer_tutor_subgraph → tutor_reply_message_node 写 [AIMessage, SystemMessage("")]，talk_graph.py L113-131 → END）；但 has_issue=False（语法正确）走 polisher_subgraph → END（talk_graph.py L173），polisher_node（polisher_subgraph.py L127-185）只写 original_text/polished_text/explanation/polish_comment 四个 state 字段从不写 messages → 前端 useStreamRuntime 只渲染 messages，语法正确的句子零反馈（用户实测：仅第一句有错误的输入出 tutor_reply，后续输入全部静默）；check_failed 走 grammar_check_fallback_node（talk_graph.py L101-110）只写 grammar_check_logs 同样零反馈，而该节点注释自述"绝不能把'没检查成'当成'没有语法问题'"。语音/文本两形态共用 HITL_route → audio_check → grammar_check_subgraph → has_issue_route（talk_graph.py L151-175），同点位修复即同时覆盖（用户要求"语音或者文本形式都要一样"）；时序"语法反馈完毕后再走 coach 回复"已由现有结构满足（反馈在 resume run 内 → END → AutoContinue 下轮 submit({}) 出 coach 话题），不得改动。改法（仅 talk_graph.py，不动子图内部与 graph 其余结构；父图节点入参注解必须 OverAllState，见 store_resolve_node L36 注释）：① 新增 polisher_reply_message_node（镜像 tutor_reply_message_node 范式）插在 polisher_subgraph 与 END 之间：读 state 的 polished_text/original_text/explanation，写 messages = [AIMessage(反馈文本), SystemMessage(content="")]；反馈文本必含"当前语句没有错误"类提示（用户指定文案方向），若 polished_text 非空且 ≠ original_text（polisher 有实际润色产出）则附 explanation 润色建议；SystemMessage("") 分隔符与 T031 同理由（反馈消息与下轮 coach 话题 AIMessage 相邻会被 assistant-ui 合并气泡）；② grammar_check_fallback_node 补写 messages = [AIMessage(诚实兜底提示，含 grammar_check_status 原因说明), SystemMessage(content="")]，empty_input/invalid_input/unavailable 三种状态均给出提示，不再静默。验证：脚本化（stdlib urllib，POST /threads/{tid}/runs/stream + GET /threads/{tid}/state）——resume 一句语法错误英文 → 消息尾部出现 tutor_reply AIMessage；resume 一句语法正确英文（如 "I went to school yesterday."）→ 尾部出现"没有错误"反馈 AIMessage + 空 SystemMessage 分隔；正确/错误句子交替两轮，每轮有且只有一条反馈消息；重启 pnpm dev 后验证（langgraph dev 子图/父图热重载不可靠，见项目记忆）；ruff 对 talk_graph.py 零新增违规；浏览器实测语音与文本各一轮均见反馈气泡
- [X] T033 [frontend] ThreadMessage 补 system 角色分支（返回 null），消除 AI 回复后的空白绿气泡（contradicts，用户报告 2026-10-22 附截图；需查官方文档留档）。现状：T031/T032 依赖的空 SystemMessage("") 分隔符经 @assistant-ui/react-langchain convertMessages.js L36-44 转为 role:"system" 的 UI 消息；thread.aui.tsx ThreadMessage（L212-223）仅分支 role === "user"，其余 role（含 system）一律落入 AssistantMessage → 渲染带 bg-(--bubble-ai) 绿底容器（px-4 py-3），空文本内容 → coach 话题/tutor 反馈下方出现空白绿气泡（截图）。assistant-ui 官方文档（/docs/elements/message-pair，已留档检索记录）明确：ThreadPrimitive.Messages 迭代由应用按 s.message.role（"user" | "assistant" | "system"）分支渲染，system 不是对话内容不应渲染为气泡；适配器 UseStreamRuntimeOptions（types.d.ts L82-131 全量核对）无消息过滤/转换入口，渲染层按角色分支是规范修法。改法：thread.aui.tsx ThreadMessage 在读取 role（L215）后、user 判定前加 `if (role === "system") return null;`（附中文注释：system 消息仅作相邻 assistant 消息块切分（T031 范式）与内部用途，不入对话流；hooks 在 return null 前已全部执行，符合 React 规则）；不扩展处理 tool 等其他角色（当前对话流无证据出现）；T031 分隔符机制保留不动（气泡切分仍靠它）。验证：浏览器实测 coach 话题、tutor 反馈、polisher 反馈气泡之后均无空气泡；相邻 AI 消息仍分属两个气泡（T031 目标不回归）；刷新页面加载历史后同样无空气泡；pnpm lint 通过
