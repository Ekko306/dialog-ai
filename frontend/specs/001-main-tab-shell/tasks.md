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
