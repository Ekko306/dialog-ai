---

description: "007 发音逐词分析面板 任务分解（依 plan/spec/data-model/contracts/quickstart 生成）"
---

# Tasks: 发音逐词分析面板（纠错气泡发音/地道入口）

**Input**: Design documents from `/specs/007-pronunciation-analysis/`

**Prerequisites**: plan.md（必需）、spec.md（用户故事）、research.md（R1~R6 决策）、data-model.md（EvaluationResult/双缓存/六态状态机）、contracts/evaluate-endpoint-contract.md（评测端点契约）、quickstart.md（人工验收）

**Tests**: 无自动化测试新增要求（与 003~006 一致，验证手段 = pytest 既有基线 + oxlint/tsc + quickstart 人工验收）。

**Organization**: 按用户故事分组，每个故事可独立实现与验收。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成任务依赖）
- **[Story]**: 所属用户故事（US1/US2/US3）
- 描述含精确文件路径

## Path Conventions

- 后端：`backend/src/`（Python 3.12 + LangGraph，uv 管理）
- 前端：`frontend/lib/`、`frontend/components/`（Next.js 15 + assistant-ui）
- 验证命令：后端 `uv run pytest tests/unit_tests tests/integration_tests/test_grammer_tutor_subgraph.py -q`（006 基线 37/37）；前端 `pnpm lint`（oxlint+oxfmt）、`pnpm exec tsc --noEmit`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 建立验证基线，确保后续改动可对比

- [x] T001 记录基线快照：后端在 backend/ 下执行 `uv run pytest tests/unit_tests tests/integration_tests/test_grammer_tutor_subgraph.py -q`（预期 37 passed，test_graph.py 为模板遗留收集错误不算）；前端在 frontend/ 下执行 `pnpm lint` 与 `pnpm exec tsc --noEmit`（记录既有错误数作为基线）；结果写入本文件「实施注记」

**Checkpoint**: 基线确立，任何回归都以此对比

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 评测通路端到端打通（后端端点 + 前端客户端 + PCM 采集复用），所有用户故事的共同前置

**⚠️ CRITICAL**: 评测数据是一二三故事的数据源，本阶段未完成不得开始用户故事

- [x] T002 [P] 在 backend/src/webapp.py 新增 `POST /audio/evaluate` 端点，严格按 contracts/evaluate-endpoint-contract.md：请求 = octet-stream 裸 PCM（16kHz/16bit/单声道）+ `ref_text` query 参数；复用 `src.tools.audio_tool.xfyun_ise.xfyun_ise_tool.xfyun_ise_tool_by_audio_data` 与 `src.talk_agent.subgraphs.grammar_check_subgraph.ise_analyze_node.parse_ise_xml(xml, max_score=5.0)` 两个现成函数（零逻辑改动）；校验链与 transcribe 同构——Content-Type 非 octet-stream 415、缺/空 ref_text 422、音频 < `_MIN_AUDIO_BYTES` 400、SDK/解析异常 500（统一 `{detail}` 形态）；同步 SDK 调用放 `anyio.to_thread.run_sync`；不 import 任何 graph/节点运行时，不改 langgraph.json；完成后 `uv run pytest tests/unit_tests tests/integration_tests/test_grammer_tutor_subgraph.py -q` 仍 37 passed
- [x] T003 [P] 新建 frontend/lib/pcm-recorder.ts：从 components/server-dictation-adapter.ts 抽取采集段为公共工具（getUserMedia → AudioContext({sampleRate:16000}) 不支持时回退默认采样率 → AudioWorklet 内联 PcmCollector 回退 ScriptProcessorNode → 线性重采样 linearResample → stop 合并 Int16 PCM；<300ms 返回过短语义而非抛错）；导出 startPcmRecording(): { status, stop(): Promise<{ pcm: ArrayBuffer, durationSeconds } | null>, cancel() }（stop 返回 null = 过短/取消/失败，具体语义在实现时以最小接口满足 rerecord-box 与 adapter 两消费方为准）；server-dictation-adapter.ts 改为内部复用该工具，**保持既有事件语义一字不动**（成功 emit onSpeech+onSpeechEnd、<300ms 空文本、失败 ended/error、cancel ended/cancelled——research R3 红线：本任务唯一验收标准 = adapter 行为零变化）
- [x] T004 [P] 新建 frontend/lib/evaluation-client.ts：按 data-model.md 定义并导出 `EvaluationWord`（word/score/flags）与 `EvaluationResult`（total/accuracy/fluency/integrity/is_rejected/words）类型；实现 `fetchEvaluation(pcm: ArrayBuffer, refText: string)`：POST `/api/audio/evaluate?ref_text=<encodeURIComponent(refText)>`，Content-Type application/octet-stream，body = pcm；200 且 `is_rejected=false` 且 `total!=null` → 返回 EvaluationResult；`is_rejected=true`/`total=null`/4xx/5xx/网络失败 → 统一抛 EvaluationError（message 区分「评测未通过：请按参考句重新朗读」与其他失败，契约「前端消费规则」节）；导出模块级双缓存 `evaluationCache: Map<messageId, EvaluationResult>`（get/set 含覆盖写）与 `recordingStore: Map<transcript, ArrayBuffer>`（get/set）；不依赖任何 React API
- [x] T005 在 components/server-dictation-adapter.ts 的成功出口（finishStopped 前、transcript 非空时）写入 `recordingStore.set(transcript, pcm.buffer)`（依赖 T003、T004；data-model.md：写入时机 = dictation stop 成功后，键 = 转写文本 = 用户发送的 raw_text）；空文本/失败/取消路径不写

**Checkpoint**: 评测通路可用——curl 直验 `/audio/evaluate`（quickstart §5 可选）+ adapter 行为零回归（语音输入转写照常）

---

## Phase 3: User Story 1 - 纠错气泡查看发音分析与评分 (Priority: P1) 🎯 MVP

**Goal**: 语音输入的纠错气泡点「发音」/「地道」任一入口 → 完整三区块面板（发音逐词分析 + 评分建议 + 语境润色），评测按需获取

**Independent Test**: 语音输入含语法错误的英文 → 纠错气泡 → 点「发音」→ 面板出现三区块（评测区块加载反馈后填充）；换点「地道」→ 同一面板内容一致

### Implementation for User Story 1

- [x] T006 [P] [US1] 新建 frontend/components/idiom-panel/pronunciation-section.tsx：两个展示区块组件（纯展示 + 受控回调，评测数据经 props 传入）
  - **发音逐词分析区块**（FR-002/FR-008，research R4）：接收 `EvaluationResult.words` 与原句，逐词渲染；着色规则 = score≥85 绿 / 70~85 黄 / <70 红 / null 不着色不编造；flags（漏读/增读/回读/替换/音素异常）以词后小角标或图例展示；「美音 📢」单路按钮（无英音无「我的」）复用 `useTtsButton(messageId, "raw", rawText, corrections, showHint)`——与纠错气泡工具栏「发音」同键 `${messageId}:raw` 缓存命中零新合成（research R4）
  - **评分建议区块**（FR-003，research R5）：四项分数 total/accuracy/fluency/integrity（label 综合评分/发音分/流利度/完整度，百分制一位小数可选）+ 评语区（本期无 ise_check_results 增强层时显示确定性档位说明，不伪造文案）+ 「↻ 重读」按钮（`onRerecord` 回调 prop，US2 接管行为，本任务仅渲染入口）
- [x] T007 [US1] 扩展 frontend/components/idiom-panel/idiom-panel.tsx（依赖 T004、T006）：props 新增 `rawText?: string`（被评测原句，correction 模式由纠错气泡传入）；mode="correction" 且 rawText 存在时，在语境润色区块上方渲染发音区+评分区，并驱动评测状态机（data-model.md 六态）：
  - 打开时：`evaluationCache` 命中（messageId 键）→ ready 直显；未命中 → `recordingStore.get(rawText)` 无 → `no_recording` 降级文案（「未找到本次录音」）且重读入口隐藏（FR-007）；有 → loading（「评测中…」脉冲点，与 006 润色生成中同款）→ `fetchEvaluation(pcm, rawText)` → 成功写 evaluationCache → ready / 失败 → failed 行内重试（重试 = 同一 PCM 重发，FR-006）
  - `is_rejected`/无效结果按契约落 failed 态（EvaluationError message 区分文案）
  - mode="polisher" 行为零变化（不传 rawText 不渲染新区块）；mode="correction" 时面板标题调整为「发音分析」，语境润色降级为区块小标题；关闭重开内容一致（FR-009，缓存天然保证）
- [x] T008 [US1] 接线入口（依赖 T007）：components/correction-bubble/score-bar.tsx 将「发音分析」静态占位（现 showHint("功能开发中")）改为真实入口——新增 `onPronunciationOpen?: () => void` prop，hasPronunciation 守卫不变，未传时保持占位行为（向后兼容）；components/correction-bubble/correction-bubble.tsx：`onPronunciationOpen` 与 `onIdiomOpen` 指向同一 `setIdiomOpen(true)`（两入口共用一面板，spec Acceptance 2），IdiomPanel 调用补传 `rawText={data.raw_text}`

**Checkpoint**: quickstart §1 全部场景可过——US1 独立可验收（含「美音播原句与气泡工具栏同段」与「两入口内容一致」）

---

## Phase 4: User Story 2 - 重读刷新评分 (Priority: P2)

**Goal**: 面板内「↻ 重读」→ 录音操作区 → 新录音重新评测 → 评分建议与逐词分析刷新；不回写气泡/线程

**Independent Test**: 打开面板 → 点「↻ 重读」→ 录音操作区出现 → 朗读并结束 → 「评测中…」→ 新结果填充；关面板气泡评分条不变、重开显示新结果

### Implementation for User Story 2

- [x] T009 [P] [US2] 新建 frontend/components/idiom-panel/rerecord-box.tsx：录音操作区组件（依赖 T003；FR-006）
  - 开始/结束/取消三控制；参考文本（原句）明确展示；录制中有进行中反馈（脉冲点/时长）
  - 内部用 `startPcmRecording()`；stop 后将 PCM 经 `onRecorded(pcm: ArrayBuffer)` 回调交出；cancel/失败由组件内部消化并提示
  - Edge Case（spec）：`navigator.mediaDevices` 不可用或 getUserMedia 权限被拒 → 明确权限提示 + 可关闭，面板其余区块不受影响；<300ms 过短 → 提示「录音太短，请重新朗读」不发起评测
- [x] T010 [US2] 重读刷新接线（依赖 T007、T009；FR-005/research R6）：idiom-panel.tsx 状态机扩展 `rerecording` 态——点「↻ 重读」→ 展开 RerecordBox（覆盖 idle/loading 视图）；`onRecorded` → loading（「评测中…」）→ `fetchEvaluation(新 PCM, rawText)` → 成功**覆盖写** evaluationCache 同键 → ready（评分建议与逐词分析随 props 刷新）→ 收起录音区；取消/关闭录音区 → 回到重读前状态无残留；失败 → failed 行内重试（重试 = 重发同一新 PCM）
  - **红线**：新结果仅注入面板 props 与 evaluationCache，不写 correctionCache、不进 LangGraph 线程、ScoreBar 读值路径零改动（spec FR-005 + quickstart §2.3）

**Checkpoint**: quickstart §2 全部场景可过——含取消无残留、权限拒绝降级、过短失败

---

## Phase 5: User Story 3 - 数据降级与零回归 (Priority: P3)

**Goal**: 无评测数据不破相（文本输入/刷新后），003~006 全部既有行为保持

**Independent Test**: 文本输入含语法错误的英文 → 打开面板 → 仅语境润色可用、发音区降级文案、重读入口不出现；复测 003~006 验收场景全过

### Implementation for User Story 3

- [x] T011 [US3] 降级路径补齐与核对（依赖 T010；FR-007）：按 spec Acceptance 3 条逐项核对——
  - 文本输入纠错气泡：面板可开、语境润色正常、发音区 no_recording 降级文案明确、重读入口不出现
  - 刷新后历史语音消息：recordingStore 已清 → 同降级（不报错不空壳）
  - 文本被改写 PCM 查不到（includes→精确匹配不命中）：同「未找到本次录音」降级
  - 发音区无数据时逐词区/分数区不渲染骨架数字（FR-008），缺失词不伪造着色
  - 发现缺口在对应文件补齐（idiom-panel.tsx / pronunciation-section.tsx），不在气泡侧加逻辑

**Checkpoint**: quickstart §3 全部场景可过

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 回归保护与留档

- [x] T012 全量回归验证（依赖 T011）：前端 `pnpm lint`（oxlint 0 错误）+ `pnpm exec tsc --noEmit`（较 T001 基线零新增）；后端 `uv run pytest tests/unit_tests tests/integration_tests/test_grammer_tutor_subgraph.py -q`（37 passed 不破）；按 quickstart §4 逐项人工复测 003（纠错气泡讲解/操作行/TTS/翻译）、004（翻译区）、005（润色气泡五操作）、006（地道面板单区块模式+纠错侧按需润色）既有场景并记录结果
- [x] T013 更新本文件「实施注记」：T001 基线数字、关键落地决策（含与 plan 偏差点）、与 003~006 组件接线点清单、T012 回归结果、人工验收调整记录

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，立即开始
- **Foundational (Phase 2)**: 依赖 T001 基线；**BLOCKS 全部用户故事**（评测数据是一二三故事共同数据源）
- **US1 (Phase 3)**: 依赖 Foundational 完成
- **US2 (Phase 4)**: 依赖 T007（重读入口与刷新目标都在 T007 建立的状态机上）；T009 仅依赖 T003 可提前并行
- **US3 (Phase 5)**: 依赖 T010（核对完整状态机后补降级缺口）
- **Polish (Phase 6)**: 依赖全部故事完成

### User Story Dependencies

- **US1**: Foundational（T002 端点 + T004 客户端 + T005 录音暂存）→ T006（纯展示组件）→ T007（集成+状态机）→ T008（入口接线）
- **US2**: T009 可在 T006/T007 完成前并行（只依赖 T003）；T010 依赖 T007 + T009
- **US3**: 依赖 T010 后核对补齐（降级态本身在 T007 已实现，本故事以验证为主）

### Within Each User Story

- 展示组件先于集成（T006 → T007）
- 集成先于入口接线（T007 → T008）
- 红线任务（T003 adapter 零行为变化、T010 不回写）单独作为验收标准

### Parallel Opportunities

- T002（后端端点）/ T003（pcm-recorder）/ T004（evaluation-client）/ T006（展示组件）四任务互不依赖文件，可全部并行（T004 依据契约文档开发，联调在 T005/T007）
- T009 与 US1 后半段（T007/T008）并行
- 单人串行推荐顺序：T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009 → T010 → T011 → T012 → T013

---

## Parallel Example: Foundational + US1 前段

```text
# 四个独立文件任务并行：
Task: "T002 backend/src/webapp.py 新增 POST /audio/evaluate 端点"
Task: "T003 frontend/lib/pcm-recorder.ts 抽取采集工具（adapter 零行为变化）"
Task: "T004 frontend/lib/evaluation-client.ts 类型+客户端+双缓存"
Task: "T006 frontend/components/idiom-panel/pronunciation-section.tsx 两区块展示"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1 + Phase 2（评测通路端到端）
2. 完成 US1（T006 → T007 → T008）
3. **STOP and VALIDATE**: quickstart §1 独立验收 US1
4. 此时已有完整价值：语音输入用户可看逐词分析 + 四项分数 + 美音示范 + 语境润色

### Incremental Delivery

1. MVP（US1）验收通过 → 加 US2（重读闭环）→ quickstart §2 验收
2. 加 US3（降级兜底）→ quickstart §3 验收
3. Polish：全量回归（quickstart §4）→ 留档
4. 每个故事独立交付，均不破坏前一故事

---

## Notes

- [P] = 不同文件、无未完成依赖
- 后端改动**唯一**在 webapp.py 新增端点（plan「后端最小适配说明」留档，用户已知悉边界）；任何触碰 graph/节点/langgraph.json 的冲动都违反 FR-011
- 缓存键红线：美音示范复用 `${messageId}:raw`（同键命中）；面板发音沿用 `${messageId}:panel-polish`（006 R2）；evaluationCache/recordingStore 为 007 新增自有 Map，互不污染
- 停在任何 Checkpoint 均可人工验收对应故事

---

## Implementation Notes（2026-10-27）

### T001 基线

- 后端：`uv run pytest tests/unit_tests tests/integration_tests/test_grammer_tutor_subgraph.py -q` → **37 passed**（test_graph.py 为模板遗留收集错误，不计入基线）
- 前端：oxlint **0 warnings 0 errors**（61 文件）；`pnpm exec tsc --noEmit` 仅 **1 个既有基线错误**（components/tool-fallback.aui.tsx:445 `dismissible`，@assistant-ui 类型演进遗留，非本 feature 引入）；oxfmt --check 有 49 个既有文件格式问题（含 tsconfig.json/run1.json 等非代码文件，既有基线）——007 触碰的 8 个文件已全部 oxfmt 通过

### 关键落地决策

1. **发音入口守卫改判（T008，重要）**：主链 ise_grade 恒为 null（R1：无音频 → ISE 短路 no_audio 不写该键，已核实 grammar_check_subgraph.py L230-231），若沿用 hasPronunciation 守卫则「发音」入口永远不出现。落地为**与「地道」同守卫（hasGrammar）**——语音/文本输入的纠错气泡均可打开面板，评测数据面板打开后按需获取，文本输入由面板内部降级（FR-007，与 spec US3 一致）；onPronunciationOpen 未传时保留 ise_grade 占位旧路径（向后兼容）
2. **美音 TTS 必须传真实 corrections（T006/T007）**：`getTtsAudioUrl` 一次请求同时合成并缓存 `${messageId}:raw` 与 `${messageId}:correct` 两段（tts-client.ts L152-161），若面板传空数组会导致 `:correct` 被原句音频污染、破坏纠错气泡示范句缓存。IdiomPanel 新增 corrections prop 由 correction-bubble 透传 data.corrections
3. **pcm-recorder 语义对齐（T003）**：抽取后 adapter 保持零行为变化——成功/空文本/失败/取消四路径的 emit 与 status 语义逐一对照保留；recorder.stop() 统一 null 语义（过短/取消/启动失败），adapter 以自身 ended 标志区分是否 emit 空文本结果
4. **评测端点校验顺序（T002）**：415 → 400（音频过短）→ 422（缺 ref_text），使 quickstart §5 的 curl（无 ref_text + 过短 body）按契约期望返回 400
5. **RerecordBox 时长计时**：录制中每 500ms 刷新秒数显示；卸载 useEffect 兜底 cancel 释放麦克风
6. **重试语义**：failed 态「重新评测」= 同一 PCM 重发（pcmRef 暂存，契约「前端消费规则」）；重读失败后重试同样重发新 PCM

### 与 003~006 组件接线点

| 接线点 | 文件 | 说明 |
|---|---|---|
| 美音示范 | pronunciation-section.tsx → useTtsButton("raw") | 同键 `${messageId}:raw` 命中气泡工具栏缓存 |
| 面板宿主 | idiom-panel.tsx | 006 面板扩展评测区 + 重读；polisher 模式零变化 |
| 发音入口 | score-bar.tsx / correction-bubble.tsx | 占位改真实入口，与地道同开一面板 |
| 录音暂存 | server-dictation-adapter.ts | stop 成功转写后写 recordingStore（键=转写文本） |
| 采集复用 | lib/pcm-recorder.ts（新） | adapter 与 RerecordBox 共用同一采集链 |

### T012 回归结果

- 后端 pytest：**37 passed**（实现后复跑）
- 前端 oxlint：**0/0**（61 文件）；tsc：仅既有基线 1 错误（零新增）；007 触碰文件 oxfmt 全通过
- 后端导入验证：`/audio/evaluate` 已注册于 FastAPI 路由表（与 /audio/transcribe 并列）
- quickstart §1~§3（US1/US2/US3）与 §4 零回归人工复测：**待用户验收**

### 待人工验收清单

- §1 三区块面板（语音输入路径，含两入口一致性、美音同段缓存）
- §2 重读刷新（含取消无残留、权限拒绝、过短）
- §3 降级（文本输入/刷新后/文本改写）
- §4 003/004/005/006 零回归复测
- §5 端点 curl 直验（可选）
