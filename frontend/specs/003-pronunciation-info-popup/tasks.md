---

description: "Task list for 003-pronunciation-info-popup implementation"

---

# Tasks: 发音逐词分析信息弹窗（单击气泡"发音/地道"弹出）

**Input**: Design documents from `/specs/003-pronunciation-info-popup/`

**Prerequisites**: plan.md（必须）、spec.md（必须）、research.md、data-model.md、contracts/、quickstart.md

**原型图（每项 UI 任务的视觉基准）**: `frontend/docs/mockups/子功能-对话演示气泡-单击发音或地道-弹出更多信息弹窗.jpg`

**Tests**: 未要求 TDD/测试套件；验证走 quickstart.md 场景（S1~S6）+ 既有后端冒烟脚本 + lint/build，集中在 Polish 阶段。

**Organization**: 按 User Story 分组；后端改动均为 Constitution 原则 II 允许的字段透出/格式适配（见 research.md R3/R5/R6 留档）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 所属 User Story（US1/US2/US3）
- 描述含精确文件路径

## Path Conventions

Web 前后端分离（monorepo）：`backend/src/`、`frontend/components/`。本功能前端新增目录 `frontend/components/pronunciation-popup/`，后端改动全部落在既有文件（无新模块）。

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 功能目录骨架，后续任务往内填充

- [X] T001 创建前端功能目录 `frontend/components/pronunciation-popup/`，按 plan.md 项目结构建立骨架文件：pronunciation-popup.tsx、word-analysis-section.tsx、score-section.tsx、polish-section.tsx、word-marks.ts、use-popup-audio.ts、popup-store.ts（各文件仅导出占位，后续任务填充实现）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 播放基建与后端 TTS 适配，US1/US3 的播放源都依赖

**⚠️ CRITICAL**: 播放源相关任务开始前必须完成 T002~T003；弹窗音频能力依赖 T005

- [X] T002 [P] 后端 `backend/src/tools/audio_tool/xfyun_tts/xfyun_tts_tool.py`：`xfyun_tts_tool_by_text` 增加可选参数 `vcn: str | None = None`——None 时行为完全不变（`os.getenv("TTS_VCN", "vixy")` 兜底），传值时透传给 `TtsClient(vcn=...)`；既有调用方零感知（research.md R5.2）
- [X] T003 后端 `backend/src/webapp.py` 新增 `POST /audio/tts` 路由（contracts/audio-tts.md）：实现前先完成 research.md 未决项外部确认——①讯飞控制台试听确认英音发音人 vcn，②用真实 `ise_xml_info` 样本核对 `time_len` 位置与重读/连读字段；`ACCENT_VCN = {"american": "vixy", "british": "<确认结果>"}`；JSON 请求 `{text: str 非空≤500, accent: "american"|"british" 可选默认 american}`；未知 accent → 400，text 空/超长 → 400，非 JSON → 415，SDK 失败 → 500（british vcn 未确认时走 500/前端置灰路径）；同步 SDK 用 `anyio.to_thread.run_sync`（同 `/audio/transcribe` 模式）；成功响应 `audio/mpeg` MP3 二进制；不鉴权、不落盘、不改 graph（依赖 T002）
- [X] T004 [P] 前端 `frontend/components/server-dictation-adapter.ts`：`finishStopped` 成功路径把本轮 Int16 PCM 暂存到模块级内存槽（只保留最近一轮，新录音覆盖），并导出 `getLastRecording(): Int16Array | null` 与 PCM→WAV Blob 工具（懒创建 objectURL 由消费方负责）；刷新清空，后端零改动（research.md R4）
- [X] T005 [P] 前端 `frontend/components/pronunciation-popup/use-popup-audio.ts`：单例播放器 hook——`play(source)` 按 `(text, accent)` 请求 `/api/audio/tts` 并做内存 Map 缓存；同一时刻只播一个源（新播放打断旧播放）；支持 `loop` 开关（循环跟读）、停止、`revokeObjectURL` 清理；暴露加载/播放/错误状态供按钮置灰与提示（FR-015 不静默失败）；关闭清理接口供弹窗卸载调用（contracts/audio-tts.md §4）

**Checkpoint**: TTS 按需合成链路（T002+T003）与前端音频基建（T004+T005）就绪，可用 curl 冒烟 `/api/audio/tts`（quickstart S5.3）

---

## Phase 3: User Story 1 - 从气泡打开弹窗并查看逐词发音分析 (Priority: P1) 🎯 MVP

**Goal**: 用户单击语音气泡"发音/地道"入口弹出弹窗，逐词着色 + 五类图例 + 三播放源 + ↻重读可用

**Independent Test**: 一轮带评测结果的朗读 → 单击"发音"→ 弹窗出现、逐词着色与图例一致 → 三个播放源出声 → "↻重读"重放（quickstart S1）

### Implementation for User Story 1

- [X] T006 [US1] 前端 `frontend/components/pronunciation-popup/word-marks.ts`：逐词标注派生——输入 `ise_check_results.pronunciation`，输出 `WordMark[]`；三档阈值常量（`score < 60 → 待提高 poor`、`60 ≤ score < 85 → 小瑕疵 fair`、`score ≥ 85 → 很完美 good`、`score == null → 不标注`）；二级推导：`comment` 含"连读"→ liaison、含"重读"→ stress（可叠加，默认 []）；含原句按词切分对齐与标点还原（data-model §2.1，research.md R2）
- [X] T007 [US1] 前端 `frontend/components/pronunciation-popup/pronunciation-popup.tsx`：弹窗容器——Base UI Dialog + Portal（参照 `frontend/components/scene-select/scene-select-popup.tsx` 模式）；按原型图布局三大区块（发音逐词分析 / 评分建议 / 语境润色）+ 标题"发音逐词分析"+"发音规则?"+右上 ×；用 `useLangChainState` 读取快照：`ise_check_results`、`ise_grade`、`ref_text`、`polisher`、`ise_status`（contracts/state-data.md 全字段可缺省处理）；**打开弹窗时将读取值复制进本地 state 冻结**（弹窗生命周期内不随后续 values 流更新，保证"打开时刻快照"语义，关闭丢弃）；支持 `initialSection` 锚点（"发音"→逐词区、"地道"→润色区，仅滚动定位差异）；关闭时停止播放、Tab 复位"地道美式"（FR-001/002/014）；支持受控 `open/onOpenChange`（同 SceneSelectPopup 签名）
- [X] T008 [US1] 前端 `frontend/components/thread.aui.tsx`：`UserMessage`（:579 起）气泡下方新增"发音"与"地道"两个入口按钮（原型图：气泡下方左侧小按钮行），仅语音 modality（`s.message.metadata.modality === "voice"` 先例 :217）用户气泡渲染；点击打开 `PronunciationPopup`（发音 → initialSection="analysis"，地道 → initialSection="polish"）；按钮样式对照原型图（FR-001）
- [X] T009 [US1] 前端 `frontend/components/pronunciation-popup/word-analysis-section.tsx`：逐词着色区——按 `WordMark` 渲染词序列，三档配色（待提高红/小瑕疵橙/很完美绿）+ 连读绿色下划线曲线 + 重读词绿色粗下划线；顶部五类图例与句中标注视觉一致（原型图逐项比对）；`pronunciation.length === 0 || ise_status !== "ok"` → 空态提示"本轮没有评测数据"（FR-003/004/015）；长句可换行/滚动不溢出
- [X] T010 [US1] 前端 `frontend/components/pronunciation-popup/word-analysis-section.tsx`：播放行——"英音🔊 美音🔊 我的🔊"+ 右侧"↻重读"；英音/美音文本源 `ref_text || polisher.original_text` 经 use-popup-audio 以 accent=british/american 播放；"我的"读 `getLastRecording()` WAV 回放；↻重读 = 重放最近一次成功合成的示范音频（优先缓存）；文本源为空/无录音 → 控件置灰（FR-005/006/015，依赖 T003、T004、T005）

**Checkpoint**: US1 独立可测——弹窗开合、逐词标注、三播放源、重读全部可用（quickstart S1）；US2/US3 区块此时可为占位空态

---

## Phase 4: User Story 2 - 查看评分建议与语速仪表盘 (Priority: P1)

**Goal**: 弹窗中部量化评分：综合徽章 + 三维度进度条 + 语速仪表盘 + 中文建议列表

**Independent Test**: 打开弹窗 → 徽章/三进度条/仪表盘数值与评测产出完全一致 → 建议逐条可读（quickstart S2）

### Implementation for User Story 2

- [X] T011 [P] [US2] 后端 `backend/src/talk_agent/subgraphs/grammar_check_subgraph/ise_analyze_node.py`：确定性字段透出——`parse_ise_xml` 增读 rec_paper 子节点 `time_len`（ms，确切属性位置用真实样本核对，research 未决项 #3），成功路径返回 dict 追加 `"speed_wpm": round(词数 / (time_len/60000), 1)`（time_len 缺失/为 0 → None）；`ise_analyze_node` 成功路径 `ise_check_results` 追加 `"scores": {total, accuracy, fluency, integrity}`（`parse_ise_xml` 既有产物原样透出，零新计算）；降级路径 `_degraded` 不带新字段（契约即"缺省=空态"）；不碰 LLM 契约与节点判定逻辑（research.md R3，Constitution II）
- [X] T012 [US2] 前端 `frontend/components/pronunciation-popup/score-section.tsx`：综合评分徽章（SVG 圆环，数值居中）+ 流利度/发音分/完整度三条带数值进度条（宽度=分值%，颜色随档位绿/橙，对照原型图）；数值直取 `scores` 不做四舍五入错位（SC-004）；空态：区块数据缺失显示"本轮没有评测数据"（FR-007/015）
- [X] T013 [US2] 前端 `frontend/components/pronunciation-popup/score-section.tsx`：语速仪表盘——SVG 弧形（量程 50→250 词/分，110/150/190 刻度点，Slow→Fast 绿→黄→红渐变），当前语速数字+"（语速）"居中，指针角度线性映射并夹取 [0,1]；`speed_wpm == null` → 仪表盘空态占位（FR-008/015；依赖 T011）
- [X] T014 [US2] 前端 `frontend/components/pronunciation-popup/score-section.tsx`：建议列表——`advice` 按句切分（。！？）逐条展示；综合评分兜底链 `scores.total ?? ise_grade ?? null`（FR-009；依赖 T012 同文件续做）

**Checkpoint**: US1+US2 均独立可用；评分数值与后端 `threads/{id}/state` 抽查一致（quickstart S2）

---

## Phase 5: User Story 3 - 查看语境润色的多风格改写 (Priority: P2)

**Goal**: 弹窗底部三风格 Tab（地道美式默认/商务正式/地道英式）+ 优化句与中文解释 + 四工具 + AI 生成标注

**Independent Test**: 打开弹窗 → 默认 Tab 内容完整 → 切换即时更新 → 复制/收藏/朗读/循环跟读可用（quickstart S3）

### Implementation for User Story 3

- [X] T015 [P] [US3] 后端 `backend/src/llm_models/prompts/skills/english_expression_polisher/polisher_schema.py`：新增 `StylePolish(BaseModel){polished_text: str, explanation: str}`；`PolishResult` 保留原三字段语义不变（=地道美式默认风格），追加 `style_business: StylePolish | None = None`、`style_british: StylePolish | None = None`，字段 description 注明风格定位与"无法生成时为 null"（research.md R6.1）
- [X] T016 [P] [US3] 后端润色提示词扩展：`backend/src/llm_models/prompts/skills/english_expression_polisher/SKILL.md` Section 6（Required Output Format）追加三风格输出要求段落（各风格独立改写+中文解释、风格定位：地道美式=日常口语/商务正式=职场正式/地道英式=英式习惯表达、单风格无需修改或无法生成时该字段返回 null）；`backend/src/llm_models/get_model.py` `get_polisher_model` system prompt 核心要求追加"按三风格输出"一条；模板变量仍只有 `text`、partial 固化与 TAG_NOSTREAM 不动（research.md R6.2/R6.3）
- [X] T017 [US3] 后端校验与 state 适配：`backend/src/talk_agent/subgraphs/polisher_subgraph/polisher_service.py`——既有三条确定性校验规则（长度比 0.5×~3×、英文≥3 字母、中文混入 ≤20%）抽成小函数，主风格流程不变，对 `style_business/style_british` 取到才校验、失败置 None 不重试不抛错；`polish_text` 返回值增加 `style_business/style_british`（`{polished_text, explanation}` 或 None）；`backend/src/talk_agent/state.py` `PolisherOutput` 追加 `style_business: dict | None`、`style_british: dict | None`；`backend/src/talk_agent/subgraphs/polisher_subgraph/polisher_nodes.py` **仅做最小字段透传**（analyze I1 裁决）：①初始化 dict 补两个默认 None key；②成功分支 update 时以 `result.get("style_business"/"style_british")` 透传两字段——禁止改任何分支/判定/日志逻辑与图结构（Q1 边界内的数据管道，理由留档 plan.md Constitution Check II）（research.md R6.4/R6.5；依赖 T015）
- [X] T018 [US3] 前端 `frontend/components/pronunciation-popup/polish-section.tsx`：三风格 Tab 行——"地道美式"（默认选中）/“商务正式”/“地道英式”，选中态绿色下划线高亮（自绘 button 行，对照原型图）；Tab 映射：american ← `polisher.polished_text/explanation`、business ← `style_business`、british ← `style_british`；切换即时更新不刷新（SC-005）；单风格 null/缺失 → 该 Tab 空态提示，不影响其他 Tab；`polish_status !== "success"` → 全区块空态（FR-010/015，依赖 T017 数据、T007 容器）
- [X] T019 [US3] 前端 `frontend/components/pronunciation-popup/polish-section.tsx`：内容与工具行——优化后句子 + 中文修改解释（保留换行排版）+ 工具行"循环跟读🎤 复制⧉ 收藏☆ | AI🔊"：复制用 `navigator.clipboard.writeText` + 成功态反馈；收藏读/写 `popup-store.ts` 内存 Set（键=polishedText）+ 状态标记；AI 朗读与循环跟读经 use-popup-audio 播放当前 Tab 的 polishedText（loop 开关，激活态可视）；底部"内容由 AI 生成"标注；polishedText 为空时工具置灰（FR-011/012/013/015，依赖 T005、T018 同文件续做）

**Checkpoint**: 三个 User Story 全部独立可用（quickstart S1~S3 逐项过）

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 边界场景、回归与原型图目视比对

- [X] T020 前端状态残留与快照防护复查：`frontend/components/pronunciation-popup/pronunciation-popup.tsx`——重复快速开关无残留（Tab 复位、播放停止、loop 复位、revokeObjectURL 清理）；弹窗打开期间新消息到达内容不被打断（T007 冻结快照，不随 values 流更新）；极长句子三区块排版不溢出（Edge Cases 全表，依赖 T007/T018/T019）
- [X] T021 [P] 前端质量门禁：`cd frontend && pnpm lint && pnpm build` 全绿（oxlint/oxfmt + Next 编译）
- [X] T022 后端回归验证：`cd backend` 后用项目 .venv（`$env:PYTHONUTF8="1"`）运行 `uv run python src/talk_agent/subgraphs/polisher_subgraph/polisher_test.py` 通过；`uv run langgraph dev --no-reload` 启动无报错；`ise_analyze_node` 冒烟（`python src/talk_agent/subgraphs/grammar_check_subgraph/ise_analyze_node.py` 自测）通过；curl 冒烟 `POST /audio/tts`（american 必过；british 视 vcn 确认结果，未确认则验证 500/置灰路径）（依赖 T002/T003/T011/T015/T016/T017）
- [X] T023 端到端验证与原型图比对：按 `frontend/specs/003-pronunciation-info-popup/quickstart.md` S1~S5 逐项过；S6 将真实界面与原型图 `frontend/docs/mockups/子功能-对话演示气泡-单击发音或地道-弹出更多信息弹窗.jpg` 并排目视比对（布局/配色/标注样式/文案，不一致以原型图为准）；确认主链回归（教练回复/语法纠错/主链 TTS 不受影响）（依赖 T020/T021/T022）
  （2026-11-02 完成：TTS-PCM 文件通道真实评测两轮，S1~S3/S5/S6 全过，S4 边界三行留真实环境复测；
  过程中修复 4 项——入口 modality 不可达、sil token、time_len→帧位差、british vcn=catherine，详见 quickstart 测试记录）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，立即开始
- **Foundational (Phase 2)**: 依赖 T001；T002/T004/T005 可并行，T003 依赖 T002
- **US1 (Phase 3)**: 依赖 T005（播放）、T004（"我的"）；T006→T009 同数据链，T007 为容器（T009/T010 嵌入），T008 依赖 T007
- **US2 (Phase 4)**: 前端依赖 T007（容器）；T011 为后端字段透出（可与 US1 前端并行）；T013 依赖 T011 真实数据；T012→T014 同文件顺序
- **US3 (Phase 5)**: 后端 T015/T016 并行 → T017；前端 T018/T019 依赖 T007 与 T005；T019 依赖 T018 同文件
- **Polish (Phase 6)**: 依赖全部 Story 完成

### User Story Dependencies

- **US1 (P1)**: Foundational 后即可开始，不依赖其他 Story
- **US2 (P1)**: 依赖 US1 的弹窗容器（T007）；评分数据链（T011）独立可并行
- **US3 (P2)**: 依赖 US1 的弹窗容器（T007）与播放 hook（T005）；后端润色扩展（T015~T017）独立可并行

### Parallel Opportunities

- Phase 2：T002 ∥ T004 ∥ T005（三不同文件）；T003 在 T002 后
- 跨 Story：US1 前端 ∥ T011（US2 后端）∥ T015 ∥ T016（US3 后端）互不相干文件
- US2 内：T012 前可并行做 T011；US3 内：T018 前可并行做 T015~T017

---

## Parallel Example: 跨 Story 并行

```text
# Foundational 完成后，三条互不相干的线可并行推进：
线 A（US1 前端）: T006 → T007 → T008 → T009 → T010
线 B（US2 后端）: T011（ise_analyze_node.py 字段透出）
线 C（US3 后端）: T015（polisher_schema.py）∥ T016（SKILL.md + get_model.py）→ T017
# 前端同一文件内的任务（T012→T013→T014、T018→T019）保持顺序，不可并行
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 完成 Phase 1 + Phase 2（T001~T005）
2. 完成 Phase 3（T006~T010）→ **STOP and VALIDATE**：quickstart S1 独立验证
3. 此时弹窗核心价值（逐词可视可听）已交付，US2/US3 区块以空态占位

### Incremental Delivery

1. Setup + Foundational → 播放基建就绪
2. +US1 → MVP（弹窗开合 + 逐词分析 + 播放）
3. +US2 → 量化评分可视（T011 字段透出 + 评分区块）
4. +US3 → 三风格润色（后端 schema/提示词扩展 + 润色区块）
5. Polish → 边界场景、回归、原型图目视比对（S6）

### Notes

- 所有后端任务须守住 Constitution II 边界：字段透出/格式适配，不碰图结构与节点逻辑；越界立即停手回报
- 所有 UI 任务以原型图为视觉基准；实现完成必须做 S6 目视比对
- 后端运行约束：PYTHONUTF8=1、--no-reload、项目 .venv；改动仅推送 zzl-pure 分支
- Commit 建议：每个 Phase 完成即提交（含 Phase 2 后、每个 Story Checkpoint 后），便于回退
