---

description: "Tasks for feature 003-grammar-correction-bubble"
---

# Tasks: 子功能-对话演示气泡-语法纠错场景

**Input**: Design documents from `/specs/003-grammar-correction-bubble/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/correction-message-contract.md, contracts/tts-bypass-contract.md, quickstart.md

**Tests**: 本 feature 未要求自动化测试——验收以 quickstart.md 手动验收指南（§0~§6）与原型图目视比对为准。原型图基准：展开态 `frontend/docs/mockups/子功能-对话演示气泡-语法纠错场景.jpg`；收起态与跟读面板以 spec.md 原型图小节的文字描述为基准。

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Web app: `backend/src/talk_agent/`（LangGraph）、`frontend/`（Next.js App Router + assistant-ui）
- 新增前端代码收敛四处（plan.md 项目结构）：`frontend/components/correction-bubble/`、`frontend/components/follow-along-panel/`、`frontend/lib/audio-manager.ts`、`frontend/lib/tts-client.ts`
- 后端唯一改动点：`backend/src/talk_agent/talk_graph.py → tutor_reply_message_node`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 确认联调环境可用（quickstart.md 前置准备）

- [x] T001 验证开发环境启动：根目录 `pnpm dev:backend`（http://127.0.0.1:2024）与 `pnpm dev:frontend`（http://localhost:3000）均正常启动，Tab1 自由对话可收发消息（quickstart.md 前置准备节）——已验证：backend:200 / frontend:200

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 契约透传与音频基础设施——US1 依赖 T002/T003 的透传验证，US3/US4 依赖 T003/T004 的音频能力

**⚠️ CRITICAL**: 用户故事实现开始前必须完成本阶段

- [x] T002 后端唯一改动：在 backend/src/talk_agent/talk_graph.py 的 tutor_reply_message_node 中，构造 AIMessage 时追加透传（数据全部取自现有 state 字段，纯透传，不改图拓扑/节点逻辑/LLM 调用；缺省字段允许省略键）。**实施修正**：键名为 `additional_kwargs["metadata"]["correction_data"]`（前端 convertMessages 仅映射 additional_kwargs.metadata → metadata.custom），feedback 标注预留字段（analyze F2）；已同步回 contracts/correction-message-contract.md
- [x] T003 [P] 创建 frontend/lib/audio-manager.ts 全局音频管理器：模块级单例 HTMLAudioElement + zustand store（AudioPlaybackState：sourceId `{messageId}:raw|correct|panel` / status idle|loading|playing|paused / blobUrl / rate / loop / currentTime / duration，字段定义见 data-model.md Entity 2）；暴露 play(sourceId, blobUrl)、stop、pause、resume、setRate、setLoop；任何 play 先 stop 当前源（FR-005 全局互斥）；timeupdate/loadedmetadata/ended 事件同步进度与状态；倍速用原生 playbackRate，循环用原生 loop 属性（analyze F4 决议）
- [x] T004 [P] 创建 frontend/lib/tts-client.ts TTS 旁路客户端（完整契约见 contracts/tts-bypass-contract.md）。**实施修正**：改用无状态 `POST /api/runs/wait`（不依赖 thread id，旁路任务不残留到对话线程历史；输入输出契约不变），已同步回契约文档；从响应终态 values 取 raw_audio / tutor_audio，base64 → Uint8Array → Blob（MIME 字节头探测：FF FB/49 44 33 → audio/mpeg，52 49 46 46 → audio/wav，失败默认 audio/mpeg，另兼容 {"b64":...} 与字节数组两种序列化形态）；按 `{messageId}:{raw|correct}` 缓存 Blob URL，同句二次点击不重复合成；合成失败/空音频返回 null 不抛错（FR-012）
- [x] T005 契约透传联调验证（quickstart.md §0，implement 第一验收步）——**已通过（API 级）**：runs API 全链路（新线程 → HITL resume → grammar_check → tutor 分支），终态 AI 消息 `additional_kwargs=["metadata"]`、`correction_data` 五字段完整（raw_text/tutor_reply/corrections[{wrong,correct,type}]/ise_grade:null/feedback:null）；前端映射链经包源码静态证实（convertMessages.ts L136）。Fallback 未启用（契约文档留档备查）。浏览器目视部分并入 T019 人工验收

**Checkpoint**: 契约透传可读（或 Fallback 就位）+ 全局音频管理器与 TTS 客户端就绪——用户故事可开始 ✅

---

## Phase 3: User Story 1 - 纠错气泡特殊渲染与讲解展开/收起 (Priority: P1) 🎯 MVP

**Goal**: 含纠错内容的 AI 消息按专用气泡双态渲染（默认展开：原句行+功能行+讲解+✅正确句+操作栏；收起：紧凑两行），普通消息零回归

**Independent Test**: 说一句错误英语 → 收到默认展开态纠错气泡（与 mockup 目视比对一致）→ 点「‼语法纠错」收起为两行（与收起态截图基准一致）→ 再点展开复原 → 完全正确的句子走普通气泡样式

### Implementation for User Story 1

- [x] T006 [P] [US1] 创建 frontend/components/correction-bubble/correction-toolbar.tsx 功能行组件：左「文A」翻译按钮（本故事仅渲染，交互行为归 US5）、中「‼ 语法纠错」标签带 ⌃/⌄ 箭头（点击回调由 props 传入，状态归骨架）、右「AI 发音」按钮（本故事仅渲染，行为归 US3）；图标用 lucide-react，样式对照展开态 mockup
- [x] T007 [P] [US1] 创建 frontend/components/correction-bubble/correction-actions.tsx 操作栏组件：「循环跟读 | 复制 | 收藏 | AI 发音」四按钮横排（对照 mockup 底部操作栏）；收藏为 FR-014 静态占位（可点击，轻提示"功能开发中"，无副作用）
- [x] T008 [US1] 创建 frontend/components/correction-bubble/correction-bubble.tsx 气泡骨架：接收 CorrectionMessageData（data-model.md Entity 1）；`expanded` 本地 useState 默认 true（clarify 决议）；展开态渲染=原句行（raw_text）+ Toolbar + 讲解区（tutor_reply 原样渲染）+ ✅ 正确句行（取 corrections[0].correct，清单为空则不展示该行，Edge Case）+ Actions；收起态渲染=仅原句行 + Toolbar（箭头 ⌄）；点击 Toolbar「‼语法纠错」切换双态；含 parseCorrectionData 字段容错守卫
- [x] T009 [US1] 在 frontend/components/main-chat-page.tsx 的 AI 消息渲染分支挂载识别分流：经 Thread components.AssistantMessage 官方扩展点注入 CorrectionAwareAssistantMessage（thread.aui.tsx 导出原 AssistantMessage 供兜底）；读取 `s.message.metadata.custom.correction_data`；存在 → 渲染 CorrectionBubble；缺失或守卫失败 → 走现有普通气泡渲染分支一字不动（FR-013 零回归）

**Checkpoint**: User Story 1 可独立验收——气泡双态渲染 + 普通消息零回归 ✅（代码与类型链路完成；目视比对并入 T019）

---

## Phase 4: User Story 2 - 一键复制改正后的正确句 (Priority: P2)

**Goal**: 点「复制」仅将改正后完整正确句写入剪贴板，带成功反馈

**Independent Test**: 点「复制」→ 出现对勾反馈 → 任意文本框 Ctrl+V → 粘贴内容 = 完整正确英语句，无讲解/原句/多余字符

### Implementation for User Story 2

- [x] T010 [US2] 在 frontend/components/correction-bubble/correction-actions.tsx 实现复制逻辑：`navigator.clipboard.writeText(corrections[0].correct)`；成功反馈=图标短暂变对勾约 1.5s 后还原（CorrectionBubbleUIState.copied，data-model.md Entity 3）；corrections 为空时降级为禁用+提示（spec Edge Case 选定"禁用"方案，analyze F3）；复制失败走轻提示

**Checkpoint**: US1 + US2 均可独立演示 ✅

---

## Phase 5: User Story 3 - 双 AI 发音按钮（原句 / 正确句对照朗读） (Priority: P2)

**Goal**: 功能行「AI 发音」播原句、操作栏「AI 发音」播正确句；首次点击有加载态，全局互斥

**Independent Test**: 点功能行 AI → 播原句；播放中点操作栏 AI → 旧声立停、播正确句；同按钮再点不重复合成直接重播

### Implementation for User Story 3

- [x] T011 [US3] 在 frontend/components/correction-bubble/correction-toolbar.tsx 接线「AI 发音」按钮（经共享 hook use-tts-button.ts）：点击 → tts-client 请求原句音频（sourceId `{messageId}:raw`）→ audio-manager 播放；loading 期间重复点击不重复发起；失败 → 轻提示可重试，文本展示不受影响（FR-004/FR-012）
- [x] T012 [US3] 在 frontend/components/correction-bubble/correction-actions.tsx 接线「AI 发音」按钮：同 T011 模式但播放正确句音频（sourceId `{messageId}:correct`，取 tutor_audio、空则 raw 兜底）；跨按钮/跨气泡互斥由 audio-manager 单例天然满足（FR-005）

**Checkpoint**: US1~US3 均可独立演示 ✅（TTS 合成链路待 §3/§4 人工验收确认音频出声）

---

## Phase 6: User Story 4 - 循环跟读面板 (Priority: P3)

**Goal**: 点「循环跟读」底部滑入面板：正确句全文+进度条+播放/暂停+倍速+语言切换+循环开关+麦克风占位，所有播放控制作用于正确句音频

**Independent Test**: 打开面板 → 全文可见 → 播放/暂停进度同步 → 切倍速语速即时变 → 开循环播完自动重播 → 关面板对话不中断

### Implementation for User Story 4

- [x] T013 [US4] 创建 frontend/components/follow-along-panel/follow-along-panel.tsx 底部滑入面板：复用 002 已验证模式（@base-ui/react Dialog/Popup 原语 + tw-animate-css 底部滑入动画 + zustand 面板状态 FollowAlongPanelState）；布局自上而下=标题「循环跟读」+右上关闭键 → 正确句全文（无正确句时用原句，极长句可滚动）→ 进度条（当前时间/总时长）→ 圆形暂停/播放键（播前懒合成正确句音频）→ 控制排（倍速 0.75x/1.0x/1.25x 即时生效 FR-007；语言切换英语(美)可用、英语(英)/中文禁用降级 FR-009；循环开/关 FR-008）→ 底部大号麦克风按钮（UI 占位，点击轻提示"功能开发中"）；关闭面板不中断对话、不自动停声；播放控制全部委托 audio-manager（FR-005/FR-006）
- [x] T014 [US4] 在 frontend/components/correction-bubble/correction-actions.tsx 接线「循环跟读」按钮：点击打开面板并绑定当前气泡（messageId/text/rawText/corrections 经 store 传递）；面板打开时发送新消息不受影响（spec Edge Case）

**Checkpoint**: US1~US4 均可独立演示 ✅

---

## Phase 7: User Story 5 - 「文A」翻译展示 (Priority: P3)

**Goal**: 点「文A」展开/收起翻译区域；后端本期无译文字段，显示明确"暂无翻译"占位

**Independent Test**: 点「文A」→ 展开翻译区域显示"暂无翻译"占位（非报错）→ 按钮激活态 → 再点收起

### Implementation for User Story 5

- [x] T015 [US5] 在 frontend/components/correction-bubble/correction-bubble.tsx 增加翻译区域并在 frontend/components/correction-bubble/correction-toolbar.tsx 接线「文A」按钮：`translationOpen` 本地 state 切换（默认 false）；展开时在讲解区下方渲染"暂无翻译"占位提示（后端无译文字段，research.md R4 决议，FR-010）；按钮激活态样式

---

## Phase 8: User Story 6 - 气泡下方评分条展示 (Priority: P3)

**Goal**: 有数据的评分项按原型图展示，缺失项不展示，整体无数据不渲染

**Independent Test**: 有 ise_grade 时气泡下方出现「发音 x 发音分析 >」；无数据项不出现、布局不错乱（地道项真实运行不出现属预期，R5）

### Implementation for User Story 6

- [x] T016 [P] [US6] 创建 frontend/components/correction-bubble/score-bar.tsx 评分条组件（数据模型 ScoreBarDisplay）：语法纠错项=corrections.length > 0 时展示「语法纠错!! 继续加油」静态标签；发音项=ise_grade != null 时展示「发音 {ise_grade} 发音分析 >」（入口点击轻提示"功能开发中"，clarify 决议静态占位）；地道项=永不渲染（后端无数据源，R5）；三项全无数据 → 返回 null 不渲染（FR-011）
- [x] T017 [US6] 在 frontend/components/correction-bubble/correction-bubble.tsx 气泡下方挂载 ScoreBar（传入 correction_data，位置对照 mockup 气泡与下一条消息之间）

**Checkpoint**: 全部 6 个用户故事完成 ✅

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: 回归验证与验收收尾

- [ ] T018 执行 FR-013 零回归清单（quickstart.md §6）：创建新对话、HITL 中断回复、选场景弹窗（002 功能）、普通消息收发、录音转写按钮——行为均与本功能上线前一致（**待人工浏览器验收**：自动化环境无法合成真实键入事件，见实施注记）
- [ ] T019 执行 quickstart.md §1~§5 全流程手动验收：§0 已通过（API 级）；§1 展开态与 `frontend/docs/mockups/子功能-对话演示气泡-语法纠错场景.jpg` 目视比对、收起态与收起态截图文字基准比对、跟读面板与 spec US4/FR-006 文字描述比对；全程无控制台报错（Constitution 原则 IV）（**待人工浏览器验收**）
- [ ] T020 Edge Cases 复查（spec Edge Cases 全条目）：修正清单为空的降级（无 ✅ 行/复制禁用/跟读用原句）、首次合成加载态与重复点击防抖、刷新后气泡恢复默认展开态、同屏多条气泡独立展开收起且音频全局互斥、面板打开时发新消息正常、极长句换行与面板滚动（**代码侧已实现**：守卫/禁用/兜底均在组件内；浏览器复查并入人工验收）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，立即开始
- **Foundational (Phase 2)**: 依赖 T001 环境可用；T003/T004 与 T002 并行；T005 依赖 T002
- **User Stories (Phase 3+)**: 全部依赖 Phase 2 完成（US1 依赖 T005 的识别通道结论；US3/US4 依赖 T003/T004 音频基础设施）
- **Polish (Phase 9)**: 依赖全部用户故事完成

### User Story Dependencies

- **US1 (P1)**: 依赖 Foundational → 不依赖其他故事；是所有后续故事的载体
- **US2 (P2)**: 依赖 US1（操作栏已挂载）；与 US3 无文件冲突外的依赖
- **US3 (P2)**: 依赖 US1 + T003/T004；US4 的播放能力前置
- **US4 (P3)**: 依赖 US3（音频播放链路已验证）
- **US5 (P3)**: 仅依赖 US1，可与 US2~US4 并行开发
- **US6 (P3)**: 仅依赖 US1，T016 可与 US2~US5 并行

### Within Each User Story

- 组件先于挂载（T006/T007 → T008 → T009）
- 基础设施先于接线（T003/T004 → T011/T012）
- 面板先于入口接线（T013 → T014）

### Parallel Opportunities

- Phase 2 内：T002（后端）/ T003（audio-manager）/ T004（tts-client）三任务不同文件可并行
- Phase 3 内：T006 与 T007 不同文件可并行
- 跨故事：US5（文A）与 US6 的 T016（score-bar）和 US2/US3 触碰不同文件区域，人员充足时可并行；单人串行推荐按 P1→P2→P3 顺序

---

## Parallel Example: User Story 1

```bash
# Phase 2 三任务并行（不同文件）:
Task: "T002 后端 tutor_reply_message_node 透传 (backend/src/talk_agent/talk_graph.py)"
Task: "T003 全局音频管理器 (frontend/lib/audio-manager.ts)"
Task: "T004 TTS 旁路客户端 (frontend/lib/tts-client.ts)"

# US1 首两任务并行（不同文件）:
Task: "T006 功能行组件 (frontend/components/correction-bubble/correction-toolbar.tsx)"
Task: "T007 操作栏组件 (frontend/components/correction-bubble/correction-actions.tsx)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1: Setup（T001）
2. 完成 Phase 2: Foundational（T002~T005，T005 是识别通道的最终裁决）
3. 完成 Phase 3: User Story 1（T006~T009）
4. **STOP and VALIDATE**: quickstart §1——气泡双态 + 原型图比对 + 普通消息零回归
5. 此时已可演示核心载体，后续故事在此之上增量叠加

### Incremental Delivery

1. Setup + Foundational → 基础设施就绪
2. US1 → 目视比对验收（MVP！）
3. US2 复制 → quickstart §2
4. US3 双发音 → quickstart §3（懒加载旁路联调）
5. US4 跟读面板 → quickstart §4
6. US5 文A + US6 评分条 → quickstart §5 + §1 第 4 步
7. Polish → §6 零回归 + Edge Cases 复查 → 全部通过后进入 /speckit-converge

### Single Developer Strategy

按任务编号顺序串行执行即为最优路径（编号已按依赖排好）：T001 → T002~T004 → T005 → T006~T009 → T010 → T011~T012 → T013~T014 → T015 → T016~T017 → T018~T020

---

## Implementation Notes（2026-10-26 实施记录）

1. **契约实施修正两处**（均已同步回 contracts/ 并在对应任务标注）：
   - 透传键名：`additional_kwargs["metadata"]["correction_data"]`（前端 convertMessages 仅映射 additional_kwargs.metadata）
   - TTS 旁路：无状态 `POST /api/runs/wait`（不依赖 thread id，不污染对话线程历史）
2. **§0 验证方式**：浏览器自动化环境无法对 React 受控输入合成真实键入事件（三轮代理尝试均未突破），改用 runs API 级全链路验证（结论：correction_data 五字段完整透传）；UI 目视验收（T018~T020）转人工
3. **仓库既有问题（非本 feature 引入，未处理）**：
   - oxfmt 全仓 51 个文件存在格式漂移（含 package.json/next.config.ts 等未触碰文件）；本次仅格式化新增/改动的 11 个文件
   - components/tool-fallback.aui.tsx 存在 1 个既有 TS 错误（`dismissible` 属性，疑似依赖升级漂移）
4. **验证结果**：pytest 18 passed；oxlint 0 警告（改动文件）；tsc 仅剩上述既有错误；backend/frontend 端口 200

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- 每个故事完成即在 quickstart.md 对应小节验收，勿积压到最后
- 所有按钮行为未接线的故事阶段一律渲染占位（不报错、无副作用），保证每个 Checkpoint 都是可演示增量
- 预期管理：地道评分项真实运行不出现（无数据源）、文A 显示"暂无翻译"占位——均为已留档的设计决议，不是 bug
- Commit after each task or logical group
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence

---

## Phase 10: Convergence

**Purpose**: /speckit-converge（2026-10-26）对照 spec/plan/tasks 与当前代码逐项核查的剩余缺口（2 项 partial；T018~T020 人工验收任务维持原状不重复追加）

- [x] T021 补齐「AI 发音」按钮失败提示（FR-012 / US3-AC4，partial）：两处 AI 发音按钮（功能行播原句 / 操作栏播正确句）在 TTS 合成或请求失败时目前静默返回——use-tts-button.ts 的 catch 为空、correction-toolbar.tsx 无 hint 机制、correction-actions.tsx 的 showHint 未用于 TTS 失败，与跟读面板「语音合成失败，请稍后重试」行为不一致，违反契约文档「空音频/请求失败 → 失败提示可重试」状态映射。在 useTtsButton 失败路径暴露失败态（或在调用方接入 useHint），功能行与操作栏两处按钮失败时展示「语音合成失败，请稍后重试」提示，文本展示不受影响、可重试 per FR-012 / US3-AC4 / contracts/tts-bypass-contract.md (partial)——**已完成**：useTtsButton 新增 onFailed 可选回调（空音频与异常双路径触发），功能行 hint 置于按钮行下方（不打乱三按钮 justify-between 布局）、操作栏复用既有行内 hint 位；文案与跟读面板一致
- [x] T022 补齐跟读面板首次合成加载态与防重（spec Edge Cases / US4-AC2，partial）：follow-along-panel.tsx 的 isLoading 派生自 audio-manager 从不置位的 "loading" 状态（play() 直接置 playing），首次合成 3~10s 期间播放键无任何视觉反馈，用户感知为「点击无反应」；且 handleTogglePlay 无 in-flight 守卫，合成等待期重复点击会并发重复合成请求。为面板增加可感知的合成中加载态（局部 synthesizing state 或让 audio-manager 真正使用 loading 态），并在合成进行中拦截重复点击，满足 Edge Case「按钮呈加载态，用户可感知；等待期间重复点击不重复发起合成」 per spec Edge Cases / US4-AC2 (partial)——**已完成**：局部 synthesizing state（audio-manager 状态机不动，避免影响其他消费方），合成期间播放键显示脉冲加载态且 handleTogglePlay 首行拦截重复点击；顺带补齐 getTtsAudioUrl 异常路径的失败提示（原先网络异常会 unhandled rejection）
