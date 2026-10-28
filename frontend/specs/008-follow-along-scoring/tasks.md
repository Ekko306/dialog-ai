---
description: "008 循环跟读录音评测 任务分解（依 plan/spec/data-model/contracts/quickstart 生成）"
---

# Tasks: 循环跟读录音评测（开始跟读 → 综合评分）

**Input**: Design documents from `/specs/008-follow-along-scoring/`

**Prerequisites**: plan.md、spec.md、research.md（R1~R7）、data-model.md（状态机 + WAV 格式）、contracts/follow-along-scoring.md（缓存隔离红线）、quickstart.md（§1~§5 验收）

**Tests**: 无自动化测试（与 003~007 一致）；验证 = oxlint + tsc 零新增 + quickstart 人工验收。

**红线**（实现全程有效）：后端零改动；不写 007 `evaluationCache`/`recordingStore`；不触碰 007 面板/气泡行为；对 007 文件唯一改动 = `wordToneClass` 加 export（T003）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无依赖）
- **[Story]**: 所属用户故事（US1/US2/US3）

## Phase 1: Setup（基线）

- [x] T001 基线快照：`pnpm exec oxlint`（预期 0/0）与 `pnpm exec tsc --noEmit`（预期仅既有基线错误 tool-fallback.aui.tsx），记录到本文件 Implementation Notes；核对 `follow-along-panel.tsx`、`pronunciation-section.tsx`、`rerecord-box.tsx`、`evaluation-client.ts` 现状与 plan 假设一致

---

## Phase 2: Foundational（US1/US2 公共底座）

**⚠️ CRITICAL**: T002/T003 完成前不得开始任何用户故事任务

- [x] T002 [P] 新增 `frontend/lib/pcm-wav.ts`：`pcmToWavUrl(pcm: ArrayBuffer, sampleRate = 16000): string`——44 字节 WAV 头（RIFF/WAVE、PCM=1、mono、16bit、byteRate=sampleRate×2）+ 原始 Int16 PCM 直写，返回 `URL.createObjectURL(blob)`；JSDoc 注明调用方负责 revokeObjectURL（data-model 工具格式节）
- [x] T003 [P] `frontend/components/idiom-panel/pronunciation-section.tsx`：`wordToneClass` 函数加 `export` 关键字（唯一对 007 文件的改动，零逻辑变更；contracts §4 清单项）

**Checkpoint**: 装配依赖齐备，US1/US2/US3 可开工

---

## Phase 3: US1 — 开始跟读录音并查看综合评分（P1）🎯 MVP

**Goal**: 麦克风点击 → 面板内录音 → 评测 → 评分视图完整闭环

**Independent Test**: quickstart §1 全程（打开面板→录音→评分视图出现）

### Implementation for US1

- [x] T004 [P] [US1] 新增 `frontend/components/follow-along-panel/follow-along-scoring.tsx`：装配组件 `FollowAlongScoringProps { result: EvaluationResult; onRerecord: () => void }`——逐词着色句（`wordToneClass` + `mr-2` 词距 + flags ⚠ 角标，**不渲染**美音按钮与图例行，research R4）+ `<ScoreAdviceSection result onRerecord/>` 原样复用（徽章+三行分数条+虚线+评语）
- [x] T005 [US1] `frontend/components/follow-along-panel/follow-along-panel.tsx` 麦克风区状态化（data-model 状态机）：本地 `FollowAlongEvalSession`（phase/pcm/result/error），`idle`=麦克风按钮、`recording`=`<RerecordBox refText={text} onRecorded onCancel/>`、`loading`=「评测中…」、`ready`=`<FollowAlongScoring/>`、`failed`=错误文案+重新评测（重发同 pcm）；录音开始前 `audio.pause()`（若示范播放中，FR-009）；调用 `fetchEvaluation(pcm, text)`（失败 EvaluationError.message 入 error 态）；**严禁**触碰 evaluationCache/recordingStore（contracts §1 红线）

**Checkpoint**: US1 可独立验收（quickstart §1）

---

## Phase 4: US2 — 重读再评与我的录音回放（P2）

**Goal**: 评分视图可重读覆盖刷新 + 「我的」回放自己录音

**Independent Test**: quickstart §2（重读覆盖刷新 + 我的回放互不叠音 + 关面板重开从干净态开始）

### Implementation for US2

- [x] T006 [US2] `frontend/components/follow-along-panel/follow-along-panel.tsx` 补全 US2 接线：(a) 重读：`FollowAlongScoring.onRerecord` → phase 回 `recording`，新一轮成功后 `result`/`pcm` 覆盖（SC-003）；(b) 控制排新增「我的」按钮：无 `pcm` 时 `disabled`，有则 `pcmToWavUrl(pcm)` → `audio.play(\`${messageId}:follow-mine\`, url)`（contracts §1 新 sourceId；播放后 revokeObjectURL）；(c) 核对面板关闭路径：Dialog unmount 即销毁本地会话，重开从 idle 开始（R6，无显式清理钩子）

**Checkpoint**: US1+US2 均可独立验收（quickstart §1~§2）

---

## Phase 5: US3 — 示范播放仅保留英语(美)（P3）

**Goal**: 标签栏删除英音/中文，交互行为不变

**Independent Test**: quickstart §3（仅英语(美)一个标签 + 播放/语速/循环行为不变）

### Implementation for US3

- [x] T007 [P] [US3] `frontend/components/follow-along-panel/follow-along-panel.tsx`：`LANGUAGE_OPTIONS` 删除「英语(英)」「中文」两项仅留英语(美)（US3 spec 验收 1）；麦克风占位文案「按住说话，开始跟读」改「点击麦克风，开始跟读」（research R7，与点击式交互一致）

**Checkpoint**: 三个故事全部独立可验收

---

## Phase 6: Polish & Cross-Cutting

- [x] T008 回归验证：`pnpm exec oxlint` 0/0 + `pnpm exec tsc --noEmit` 零新增；对照 contracts §4 零改动清单逐项核对（backend/**、evaluation-client.ts、pcm-recorder.ts、tts-client.ts、audio-manager.ts、idiom-panel/** 除 T003 export）；003~007 场景不受影响（纠错气泡翻译/示范句、润色地道弹窗、发音逐词分析面板评测结果与跟读轮互不影响——缓存隔离硬检查点）
- [x] T009 实施注记：本文件追加 Implementation Notes（基线结果、关键落地决策、与 plan/research 的偏差、T008 结果、遗留人工验收项）；`pnpm exec oxfmt` 格式化全部触碰文件

---

## Implementation Notes（2026-10-28）

### T001 基线

- oxlint：0 warnings / 0 errors（61 文件）
- tsc：仅既有基线错误 `components/tool-fallback.aui.tsx(445,74)`（007 期间已存在，非本 feature 引入）

### 关键落地决策

1. **fetchEvaluation 被拒处理**：核实 `evaluation-client.ts` L71-73——`is_rejected === true` 或 `total == null` 在 fetchEvaluation 内部直接抛 `EvaluationError(EVALUATION_REJECTED_MESSAGE)`，008 failed 态统一 catch 即可，无需面板层二次判断（plan 契约 §2 的「消费规则」已内建）
2. **参考句重复展示消除**：跟读面板顶部本就常驻正确句全文，而 RerecordBox/评分视图均自带参考句（007 组件自带）→ 顶部全文在 `recording`/`ready` 态隐藏，`idle`/`loading`/`failed` 态保留（loading/failed 保留是为了上下文不消失）；图二布局即「彩色词句在顶部」
3. **内容区滚动**：评分视图加入后内容可能超高，面板内容容器补 `min-h-0 flex-1 overflow-y-auto`（同 2026-10-28 idiom-panel 面板修复的防顶出屏幕方案）
4. **「我的」URL 生命周期**：不在 play 后立即 revoke（播放中 revoke 可能截断按需加载），改为 ref 持有当前 URL、新播前 revoke 旧值、组件卸载 effect 兜底回收
5. **取消语义**：RerecordBox `onCancel` 回到 `evaluation ? "ready" : "idle"`——从评分视图重读中途取消不丢已有评分（spec US2 验收 3 仅约束「关面板重开」，面板内取消保留旧结果更符合直觉）

### 与 plan/research 的偏差

- 无实质性偏差。补充：`audio.status === "loading"` 也用于「我的」按钮的加载脉冲显示（复用 audio-manager 既有状态，无新代码）

### T008 回归结果

- oxfmt 4 文件格式化通过；oxlint 0/0（63 文件）；tsc 仅既有基线 1 错误（同 T001）
- 零改动清单核对：backend/**、evaluation-client.ts、pcm-recorder.ts、tts-client.ts、audio-manager.ts 零触碰；idiom-panel/** 仅 pronunciation-section.tsx 的 wordToneClass 加 export（T003）
- 缓存隔离核对：008 全程仅组件本地 state，evaluationCache/recordingStore 零引用（grep 核对 follow-along-panel/follow-along-scoring/pcm-wav 无命中）

### 遗留人工验收（T008 后）

- quickstart §1（录音评测闭环）→ §2（重读覆盖 + 我的回放 + 关面板重开干净态 + 缓存隔离）→ §3（标签单项化）→ §4（降级异常）→ §5（003~007 零回归目视）

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup T001 → Foundational T002/T003（并行）→ US1 T004/T005 → US2 T006 → US3 T007（可提前并行）→ Polish T008/T009

### User Story Dependencies

- **US1**（T004→T005）: 依赖 Foundational；T004 与 T003 可并行，T005 依赖 T003/T004
- **US2**（T006）: 依赖 US1 状态机（T005）；依赖 T002（pcmToWavUrl）
- **US3**（T007）: 仅宿主文件小改，可在 T005 前或与 US2 并行（同文件注意先后）

### Parallel Opportunities

- T002 / T003 / T004 / T007 四任务不同文件可全并行

---

## Implementation Strategy

### MVP First

1. T001 → T002/T003 → T004/T005（US1 完整闭环）
2. **STOP and VALIDATE**: quickstart §1 人工验证
3. 续 T006（US2）→ T007（US3）→ T008/T009

### Notes

- 与 007 缓存隔离是全程红线：任何写入 evaluationCache/recordingStore 的实现都视为错误实现
- 语速仪表盘不做（spec Assumption）；ScoreAdviceSection 输出即评分界面全貌
- 「我的」回放 loop 跟随全局循环开关（research R3 已知行为，不做特殊处理）
