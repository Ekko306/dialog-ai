# Tasks: 语境润色弹窗（地道入口）

**Input**: Design documents from `/specs/006-idiom-panel/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/polisher-bypass-contract.md ✅, quickstart.md ✅

**Tests**: 前端无测试基建（005 T013 决议沿用）：验证走 oxlint + tsc + pytest 回归 + quickstart 人工验收；后端零改动不新增测试面。

**Organization**: 按用户故事分组。Foundational 承载弹窗壳与旁路客户端（US1/US2 共用），US1 润色侧接线（即时数据），US2 纠错侧接线（按需生成状态机），US3 零回归与留档。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 不同文件、无未完成依赖，可并行
- **[Story]**: 所属用户故事（US1/US2/US3）
- 所有路径相对 `frontend/`（SPECIFY_INIT_DIR）

## Path Conventions

```text
frontend/
├── lib/polisher-bypass-client.ts                    # T002 新增
├── components/idiom-panel/idiom-panel.tsx           # T003 新增
├── components/polisher-bubble/polisher-score-bar.tsx # T004 修改
├── components/polisher-bubble/polisher-bubble.tsx    # T005 修改
├── components/correction-bubble/score-bar.tsx        # T006 修改
└── components/correction-bubble/correction-bubble.tsx # T007 修改
backend/                                              # 本 feature 零改动
```

---

## Phase 1: Setup

**Purpose**: 建立回归基线，锁定既有错误清单

- [x] T001 运行基线快照：后端 `pnpm dev` 环境外直接 `uv run pytest backend/tests -q`（在仓库根目录，记录用例总数与通过数）；前端 `pnpm oxlint` 与 `pnpm tsc --noEmit`（在 frontend/ 目录），记录既有基线错误（已知：components/tool-fallback.aui.tsx TS2339 一处），写入 tasks.md 末尾实施注记备查

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 弹窗壳组件 + 旁路客户端——US1 与 US2 的共同底座，完成后两故事可独立推进

**⚠️ CRITICAL**: 未完成本阶段不得开始 US1/US2 接线

- [x] T002 [P] 创建 lib/polisher-bypass-client.ts，严格按 contracts/polisher-bypass-contract.md 实现：`PolisherBypassError` 错误类；`fetchOnDemandPolish(correctedSentence)` POST /api/runs/wait（assistant_id 取 `process.env.NEXT_PUBLIC_POLISHER_ASSISTANT_ID || "polisher"`，input 仅 `{raw_text: correctedSentence}` 不传 enable_tts，stream_mode "values"，响应按 `data.values ?? data` 兼容解析，取 `values.polisher` 六字段）；模块级 `onDemandCache: Map<string, {polished_text, explanation}>`（键 messageId，成功且 polished_text 非空才写缓存，fallback 也写、skipped/网络失败不写）；`fetchPanelPolishAudio(messageId, correctedSentence, polishedText)` 复用 tts-client 导出的 `fetchTtsAudio(correctedSentence, [{wrong: correctedSentence, correct: polishedText, type: "polish"}])` 取 correct 位 Blob 转 URL 存自有 `panelAudioCache`（键 `${messageId}:panel-polish`，禁止经 getTtsAudioUrl 以避免覆盖 `${messageId}:correct` 全局键——R2 缓存键隔离）；头注释说明契约出处与 R1/R2/R3 决议
- [x] T003 创建 components/idiom-panel/idiom-panel.tsx（依赖 T002）：`IdiomPanel` 弹窗壳 + 语境润色区块，布局基准原型图「语境润色」区块。壳：`createPortal(document.body)` 渲染 fixed 遮罩（点击关闭）+ 底部弹出面板（× 按钮、白底圆角、底部安全区内边距）。区块内容按 data-model.md IdiomPanelData props（polishedText/explanation/contextRawText）：区块标题「语境润色」、风格标签栏三项（「地道美式」默认高亮、「商务正式」「地道英式」点击 showHint("暂未开放") 内容不变，FR-008）、「优化后的句子」英文展示 + 「修改解释」中文展示、操作行四件套全部作用于 polishedText（FR-009）：循环跟读 `CorrectionBubbleFollowAlong.useOpen()`（openFollowAlong(messageId, polishedText, contextRawText, [伪条目{wrong: contextRawText, correct: polishedText, type: "polish"}])）、复制（clipboard + execCommand 兜底 + 1.5s 对勾，polisher-actions.tsx handleCopy 同款）、收藏 showHint("功能开发中")、AI 发音分支——polisher 气泡路径复用 useTtsButton(messageId, "correct", contextRawText, 伪条目, showHint)（与 005 操作栏同键缓存命中），correction 气泡路径用 fetchPanelPolishAudio（props 传入模式标记或发音回调由调用方注入，实现取二者签名统一的最小方案并在注释留档）；组件导出与 props 命名对齐 003/005 气泡族风格（"use client"、cn、lucide 图标、data-slot 命名）

**Checkpoint**: 弹窗壳可独立渲染（暂无入口触发），旁路客户端就绪——US1/US2 可开始

---

## Phase 3: User Story 1 - 润色气泡查看地道表达 (Priority: P1) 🎯 MVP

**Goal**: 润色气泡评分条出现「地道」入口，点击弹出面板即时展示已透传的润色结果

**Independent Test**: 发 `Recently, I am learning English.` → 润色气泡 → 点「地道 更多语境>」→ 面板即时显示润色句+解释；关闭重开内容一致（quickstart §1）

### Implementation for User Story 1

- [x] T004 [US1] 修改 components/polisher-bubble/polisher-score-bar.tsx：新增可选 prop `onIdiomOpen?: () => void`，追加「地道」入口列（上行「地道」、下行「更多语境」+ ChevronRight，样式对齐既有列），恒显示（FR-001，润色气泡恒有润色结果）、不显示分数；onIdiomOpen 未传时不渲染入口（向后兼容零回归）；更新头注释（延续 003 R5 决议的说明改为「006 开启入口、分数仍无数据源不显示」）
- [x] T005 [US1] 修改 components/polisher-bubble/polisher-bubble.tsx（依赖 T003、T004）：PolisherBubble 内新增 `idiomOpen` state；PolisherScoreBar 传 `onIdiomOpen={() => setIdiomOpen(true)}`；挂载 `<IdiomPanel open={idiomOpen} onClose={...} messageId={messageId} polishedText={data.polished_text} explanation={data.explanation} contextRawText={data.raw_text} mode="polisher" />`（即时数据路径 FR-004，无 loading/failed 态）；面板渲染不影响既有气泡布局（portal 至 body）

**Checkpoint**: US1 独立可验——润色气泡入口→面板→关闭→重开全链路通

---

## Phase 4: User Story 2 - 纠错气泡按需生成地道表达 (Priority: P2)

**Goal**: 纠错气泡评分条出现「地道」入口，点击后以纠正句为输入按需生成润色，含加载/失败/缓存状态机

**Independent Test**: 发 `I goes to school yesterday.` → 纠错气泡 → 点「地道 优化表达>」→ 加载反馈 → 显示针对 `I went to school yesterday.` 的润色；关闭重开零请求（quickstart §2）

### Implementation for User Story 2

- [x] T006 [P] [US2] 修改 components/correction-bubble/score-bar.tsx：L50「地道项永不渲染」占位注释替换为真实入口按钮，新增可选 prop `onIdiomOpen?: () => void`；渲染条件 `hasGrammar`（corrections 非空，FR-002 守卫）；入口列样式上行「地道」、下行「优化表达」+ ChevronRight，不显示分数；onIdiomOpen 未传时不渲染（向后兼容）；更新头注释 R5 决议说明
- [x] T007 [US2] 修改 components/correction-bubble/correction-bubble.tsx（依赖 T002、T003、T006）：CorrectionBubble 内新增 `idiomOpen` state 与按需润色状态机（data-model.md 状态机）：打开时先查 `onDemandCache`（命中直显 ready 零请求 FR-007）；未命中进入 loading（面板内容区显示加载反馈文案，FR-005）并调 `fetchOnDemandPolish(data.corrections[0].correct)`（纠正句 = corrections[0].correct，003 契约 correct 恒为完整修正句）；成功写缓存转 ready；PolisherBypassError 或 polish_status skipped 转 failed（行内重试按钮重新发起，FR-006，交互样式对齐 004 翻译失败重试）；fallback 结果照常展示（contract 消费规则）；挂载 `<IdiomPanel ... mode="correction" contextRawText={data.corrections[0].correct} />`；生成期间关闭面板不中断请求（结果照常写缓存，Edge Case ②）；不写对话线程、不改气泡本体（FR-005）

**Checkpoint**: US2 独立可验——按需生成全状态机通；US1+US2 并存互不干扰

---

## Phase 5: User Story 3 - 弹窗操作能力与零回归 (Priority: P3)

**Goal**: 操作行四件套在两面板中行为正确；003/004/005 既有行为零回归

**Independent Test**: 在 US1 面板逐项点四操作验证；复测 003/005 既有验收场景（quickstart §3/§4）

### Implementation for User Story 3

- [x] T008 [US3] 全量回归验证（依赖 T005、T007）：`pnpm oxlint` 0 错误；`pnpm tsc --noEmit` 仅 T001 记录的既有基线错误零新增；`uv run pytest backend/tests -q` 通过数与 T001 基线一致（后端零改动证明）；结果记入实施注记
- [x] T009 [US3] 在 tasks.md 追加「Implementation Notes（实施注记）」章节留档：前端无测试基建决议（沿用 005 T013）；R2 缓存键隔离的落地确认（panelAudioCache 独立键、未触碰 tts-client 既有缓存）；操作行发音双路径的最终实现形态；与 003/005 组件的接线点清单（供 007 扩展参考）
- [ ] T010 [US3] 人工验收项（**保留不勾选，待用户执行**）：按 quickstart.md §1~§5 全量走查——§1 润色入口即时渲染与关闭重开、§2 按需生成 loading/重试/缓存、§3 操作行四件套作用对象（发音播润色句非纠正句/原句）、§4 零回归复测、§5 curl 契约直验（可选）；与原型图「语境润色」区块目视比对；SC-003 弹窗循环 10 次

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)**: 无依赖，立即可做
- **Foundational (T002→T003)**: T001 后开始；T003 依赖 T002（发音分支用 client）
- **US1 (T004→T005)**: 依赖 Foundational；T005 依赖 T003+T004
- **US2 (T006→T007)**: 依赖 Foundational；T007 依赖 T002+T003+T006
- **US3 (T008→T009→T010)**: 依赖 US1+US2 全部完成

### User Story Dependencies

- US1 与 US2 共享 Foundational 但彼此零文件交集（polisher-bubble 族 vs correction-bubble 族），理论上可并行；单人串行按 P1→P2 执行
- US3 无新功能面，纯验证与留档

### Parallel Opportunities

- T002 与 T001 无依赖可并行（但 T002 需契约文件，已在盘）
- T006 与 T004 不同文件，Foundational 完成后可并行
- 无跨故事文件冲突

---

## Implementation Strategy

- **MVP First**: T001→T002→T003→T004→T005 完成即得到「润色气泡地道面板」完整增量，可先验收
- **Incremental**: 追加 T006→T007 得纠错侧按需生成；追加 T008~T010 收敛
- **后端零改动纪律**: 全部任务不触碰 backend/；若 T007 联调发现 polisher 直调隐式依赖（预期不需要），停下在 plan.md 追加留档后再最小适配
- **缓存键隔离红线**: 任何音频获取不得写入 tts-client 的 `${messageId}:raw`/`:correct` 全局键（R2）

## Notes

- 所有交互模板取自已验收基线：polisher-actions.tsx（复制/提示/跟读）、correction-bubble 翻译区（失败重试）、translation-client.ts（旁路客户端结构）
- 007 扩展预告：IdiomPanel 将在同目录扩展发音逐词分析+评分建议区块，组件拆分时预留区块级组合结构

## Implementation Notes（实施注记，2026-10-27）

### T001 基线快照

- 后端 pytest：`uv run pytest tests/unit_tests tests/integration_tests/test_grammer_tutor_subgraph.py -q` → **37 用例全过**（基线 = 有效测试集）
- 例外说明：`tests/integration_tests/test_graph.py` 为模板遗留收集错误（`from agent import graph`，本后端无该模块），006 之前即存在、与本次改动无关，不计入基线；后端零改动证据 = 有效测试集通过数与基线一致
- 前端 oxlint：0 警告 0 错误（55 文件）；tsc：仅既有基线 TS2339 一处（components/tool-fallback.aui.tsx L445，003 前遗留）

### 关键落地决策

- **状态机内聚 IdiomPanel**（T007 微调）：按需润色 loading/ready/failed 状态机未放 CorrectionBubble，而是内聚在 IdiomPanel（props 增加 `mode: "polisher" | "correction"`），两气泡仅持 `idiomOpen` state——接线点最少，007 在同一组件追加区块即可扩展
- **R2 缓存键隔离落地确认**：`panelAudioCache` 键 `${messageId}:panel-polish` 独立于 tts-client；纠错面板发音直接调 `fetchTtsAudio`（不经过 `getTtsAudioUrl`），tts-client 既有缓存与函数签名零改动
- **发音双路径最终形态**：polisher 模式 = `useTtsButton(messageId, "correct", contextRawText, 伪条目, showHint)`（与 005 操作栏同句同键，缓存命中零合成）；correction 模式 = `getPanelPolishAudioUrl(messageId, correctedSentence, 润色句)`（懒加载 + 自有缓存 + 失败轻提示「发音获取失败，请稍后重试」）
- **fallback 消费确认**：契约消费规则照实实现——fallback（原文回退）作为确定性结果照常展示并写缓存；skipped/未知状态/网络失败抛 `PolisherBypassError` 不缓存可重试

### 与 003/005 组件接线点清单（007 扩展参考）

| 文件 | 位置 | 内容 |
|---|---|---|
| polisher-bubble.tsx | L37 | `idiomOpen` state |
| polisher-bubble.tsx | L119-129 | PolisherScoreBar onIdiomOpen + IdiomPanel(mode="polisher") |
| polisher-score-bar.tsx | L29-43 | 地道入口（恒显示，可选 prop 向后兼容） |
| correction-bubble.tsx | L72-73 | `idiomOpen` state |
| correction-bubble.tsx | L158-172 | ScoreBar onIdiomOpen（correctText 守卫）+ IdiomPanel(mode="correction") |
| score-bar.tsx | L54-68 | 地道入口（hasGrammar 守卫，替换原「永不渲染」占位） |
| idiom-panel/idiom-panel.tsx | 全文件 | 弹窗壳 + 语境润色区块（007 在此扩展发音区块） |
| lib/polisher-bypass-client.ts | 全文件 | 按需润色 + 面板发音旁路（007 发音评测旁路可参照） |

### 人工验收调整记录（2026-10-27）

- **风格标签栏单项化**：用户验收拍板删除「商务正式」「地道英式」占位标签，仅保留「地道美式」高亮单项；`STYLE_TABS` 数组砍为单项（保留数组形式便于后续扩展），「该风格暂未开放」点击提示逻辑随之删除。spec FR-008/Assumptions/Edge Cases 与 quickstart §3 已同步更新

### T008 回归结果

- oxlint：**57 文件 0 警告 0 错误**（较基线 +2 文件 = 新增 bypass-client 与 idiom-panel）
- tsc：仅既有基线 TS2339 一处，**零新增**
- pytest：**37/37 与基线一致**（backend/ 本 feature 零改动，git 可证）
- 交互一致性：弹窗关闭重开（FR-010）、生成期间关闭不中断（Edge Case ②）、缓存命中零请求（FR-007）均由实现结构直接保证，人工验收在 T010 复核
