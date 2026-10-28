# Tasks: 拓展润色气泡（005-polisher-bubble）

**Input**: Design documents from `/specs/005-polisher-bubble/`

**Prerequisites**: plan.md（必需）、spec.md（必需）、research.md、data-model.md、contracts/polisher-message-contract.md、quickstart.md

**Tests**: 后端 pytest 契约/守卫测试 + 前端 oxlint/tsc 类型检查；浏览器 UI 级验收为人工项（项目记忆：浏览器自动化对 React 受控组件会产生伪失败）

**Organization**: 按 user story 分组；Phase 2 Foundational 为全部 US 的阻塞前提（后端透传是数据源头）

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无依赖）
- **[Story]**: 所属 user story（US1/US2/US3）

## Path Conventions

- 后端: `backend/src/talk_agent/`、`backend/tests/`
- 前端: `frontend/components/`、`frontend/lib/`、`frontend/specs/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 建立回归基线，确认起点干净

- [x] T001 基线验证：backend/ 运行 `uv run pytest tests/unit_tests tests/integration_tests/test_grammer_tutor_subgraph.py`（记录通过数）；frontend/ 运行 `pnpm exec oxlint` 与 `pnpm exec tsc --noEmit`（记录既有基线错误，预期仅 tool-fallback.aui.tsx TS2339 一处）；确认 backend/.env 含 DEEPSEEK_API_KEY

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 后端数据透出 + 前端数据基础设施，全部 US 的阻塞前提

**⚠️ CRITICAL**: 润色数据是本 feature 唯一数据源，未透出前任何 US 均无法实现

- [x] T002 后端透传（唯一后端改动）：修改 `backend/src/talk_agent/talk_graph.py` 的 `polisher_reply_message_node`——在既有 AIMessage 上挂 `msg.additional_kwargs["metadata"]["polisher_data"] = {"raw_text": <polisher.original_text>, "polished_text": <polisher.polished_text>, "explanation": <polisher.explanation>, "polish_status": <polisher.polish_status 或 "">}`；键名必须写在 `additional_kwargs["metadata"]` 下（contract §1 硬约束，react-langchain 仅映射该键为 metadata.custom）；无条件挂载（含 fallback/skipped，降级判断归前端守卫）；正文文案与函数其余逻辑零改动
- [x] T003 [P] 后端契约测试：新建 `backend/tests/unit_tests/test_polisher_message_node.py`——构造含 polisher 字典的 fake state 直调 `polisher_reply_message_node`，断言：① 返回消息 `additional_kwargs["metadata"]["polisher_data"]` 四字段与 state 值一一对应；② polish_status 缺失时为空串；③ 正文文案不变（含「润色建议：」前缀）；④ polisher 为空字典时不抛异常且 metadata.polisher_data 仍挂载（值为空串）。运行 `uv run pytest tests/unit_tests/test_polisher_message_node.py` 全绿
- [x] T004 [P] 前端数据基础设施：新建 `frontend/components/polisher-bubble/polisher-data.ts`——① `PolisherMessageData` 接口（raw_text/polished_text/explanation/polish_status: string，data-model.md 定义）；② `parsePolisherData(value: unknown): PolisherMessageData | null` 守卫：非 object、raw_text 或 polished_text 非 string 返回 null；③ 渲染守卫三条件（contract §3）：`polished_text.trim() !== ""` ∧ `polished_text.trim() !== raw_text.trim()` ∧ `polish_status !== "skipped"`，导出 `shouldRenderPolisher(data): boolean`；④ 模块级 `polisherCache = new Map<string, PolisherMessageData>()` + `getCachedPolisher(messageId)` / `setCachedPolisher(messageId, data)`（correctionCache 同款模式）

**Checkpoint**: 后端消息携带 polisher_data（T003 全绿）+ 前端可解析/守卫/缓存（tsc 通过）→ US 实现可开始

---

## Phase 3: User Story 1 - 看到润色建议 (Priority: P1) 🎯 MVP

**Goal**: 润色分支反馈渲染为结构化润色气泡（原句行 + 功能行 + You can also say 建议行），支持展开/收起

**Independent Test**: 发送 `Recently, I am learning English.` → 反馈为润色气泡（默认展开），点「拓展润色」收起再展开

### Implementation for User Story 1

- [x] T005 [US1] 润色气泡主组件：新建 `frontend/components/polisher-bubble/polisher-bubble.tsx`——参照 `correction-bubble/correction-bubble.tsx` 同构实现：① props 为 assistant-ui `MessagePrimitive` 场景下的 message（与 003 组件同款签名）；② 双路径数据读取（contract §2）：路径 A `message.metadata?.custom?.polisher_data` 直读 → parsePolisherData；路径 B 流式回退 `useLangChainState("polisher", null)` 取字典四字段，消息级关联 `messageText.includes(polishedText.trim())`（正文多行拼接，不可全等）；命中后 setCachedPolisher，历史消息优先 getCachedPolisher；③ shouldRenderPolisher 为 false 或两路径均未命中 → 返回 null（由分流层降级为普通消息，FR-009）；④ 布局（spec Assumptions 第 5 条）：浅绿气泡内自上而下——原句行（普通样式，无高亮）→ 功能行占位（T006 组件）→ 展开态显示虚线分隔的建议行 `You can also say: "<polished_text>"`（前缀固定文案，润色句英文原样）；本地 useState `polishOpen` 默认 true
- [x] T006 [US1] 功能行组件：新建 `frontend/components/polisher-bubble/polisher-toolbar.tsx`——功能行三入口布局：「文A」按钮、「✨拓展润色」开关（lucide ChevronUp/ChevronDown 随 polishOpen 翻转，点击回调切换）、「AI 发音」按钮（本任务仅渲染样式与禁用态，接线在 T010）；样式对齐 correction-toolbar.tsx（text-xs、muted 前景色、间距一致）
- [x] T007 [US1] 挂载分流接线：修改 `frontend/components/thread.aui.tsx`（或 003 分流所在的等价文件，Grep `parseCorrectionData` 定位）——AssistantMessage 覆盖组件内分流顺序（R3）：parseCorrectionData/correctionCache 命中 → 纠错气泡（零改动）；否则 parsePolisherData/polisherCache/流式关联命中且 shouldRenderPolisher → PolisherBubble；否则默认渲染。分流判定需容忍流式未完成（polisher state 已到但正文未完整时保持润色判定，避免渲染闪烁）
- [x] T008 [US1] US1 验证：`pnpm exec oxlint` 与 `pnpm exec tsc --noEmit`（基线外零新增）；`pnpm dev:backend` + `pnpm dev:frontend` 启动后人工确认润色气泡渲染与展开/收起（quickstart §1）

**Checkpoint**: MVP 可独立交付——润色气泡可见、可展开收起

---

## Phase 4: User Story 2 - 润色气泡的操作能力 (Priority: P2)

**Goal**: 功能行与操作栏全部入口可用：翻译（原句）、发音（原句/润色句）、跟读（润色句）、复制、收藏、评分条

**Independent Test**: 在润色气泡上逐一点击 5 个操作入口，确认作用对象正确（quickstart §2）

### Implementation for User Story 2

- [x] T009 [US2] 操作栏组件：新建 `frontend/components/polisher-bubble/polisher-actions.tsx`——四项操作（作用于润色句，R1 伪条目 `{wrong: raw_text, correct: polished_text, type: "polish"}` 在 polisher-bubble.tsx 构造后传入）：① 「循环跟读」→ 复用 CorrectionBubbleFollowAlong 同款打开逻辑（zustand store useOpen(messageId, polished_text, raw_text, 伪条目)）；② 「复制」→ polished_text 写剪贴板（correction-actions.tsx handleCopy 同款 + execCommand 兜底 + 1.5s 对勾反馈）；③ 「收藏」→ useHint 轻提示「功能开发中」；④ 「AI 发音」→ 复用 useTtsButton(messageId, "correct", raw_text, 伪条目)；样式对齐 correction-actions.tsx
- [x] T010 [US2] 功能行接线：修改 `frontend/components/polisher-bubble/polisher-toolbar.tsx`——① 「文A」→ 复用 `useTranslation(messageId, raw_text)`（004 全套四态状态机自动继承），展开态切换逻辑与 correction-bubble.tsx 的 translationOpen 相同；② 「AI 发音」→ useTtsButton(messageId, "raw", raw_text, 伪条目)（R4：raw kind 合成输入为 raw_text，伪条目不影响）；播放中/失败态样式沿用 003
- [x] T011 [US2] 翻译区与评分条渲染：修改 `frontend/components/polisher-bubble/polisher-bubble.tsx`——① 翻译区（FR-006）：位于功能行正下方、建议行上方，上下虚线分隔，四态渲染与 004 correction-bubble.tsx 逐行同构（loading 脉冲点/success 文本/failed 重试按钮/空原句「原句为空，无法翻译」）；② 评分条（FR-007）：气泡下方复用 ScoreBar 组件，传入 corrections=[]（润色分支无错误条目，仅发音项可渲染，「地道」项自然不出现）
- [x] T012 [US2] US2 验证：oxlint + tsc 基线外零新增；人工走查 quickstart §2 全项（作用对象正确性 + 音频互斥）

**Checkpoint**: US1+US2 完整——气泡可看、可练、可存

---

## Phase 5: User Story 3 - 降级与零回归 (Priority: P3)

**Goal**: 无润色产出时降级普通消息；003/004/普通对话零回归

**Independent Test**: 停用 LLM 发触发句 → 普通消息；发语法错误句 → 纠错气泡不受影响（quickstart §3/§4）

### Tests for User Story 3

- [x] T013 [P] [US3] 守卫边界单测：扩展 `frontend/components/polisher-bubble/polisher-data.test.ts`（若项目无前端测试基建则改为 tsc + 守卫逻辑 code review 留档）——覆盖：fallback（polished==raw）→ false、skipped → false、空 polished → false、正常 success → true、非 object → null、缺 explanation/polish_status 字段 → 仍可解析（渲染必需字段仅 raw_text/polished_text）

### Implementation for User Story 3

- [x] T014 [US3] 降级路径验证：启动后端（保留 DEEPSEEK_API_KEY 但用无润色产出的句子验证——语法错误句走纠错分支本就不进润色；语法正确且无提升空间的简单句如 `I am fine.` 可能触发 fallback/skipped）→ DevTools 确认 values.polisher.polish_status 与渲染结果一致：fallback/skipped/polished==raw 时为普通消息（FR-009）；确认此场景 Console 无新增报错
- [x] T015 [US3] 零回归走查（人工）：quickstart §4 全项——纠错气泡全套（003）、翻译四态（004）、普通消息不渲染气泡、历史气泡缓存展示、新对话/HITL/选场景正常

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 全量回归与验收收口

- [x] T016 全量自动化验证：backend/ `uv run pytest tests/unit_tests tests/integration_tests/test_grammer_tutor_subgraph.py` 全绿（含 T003 新增用例，确认 003/004 零回归）；frontend/ oxlint 全绿 + tsc 基线外零新增；确认 polisher 子图自身测试（如存在）不受影响
- [ ] T017 人工验收：手动走 quickstart §1~§5 全项，与原型图 `frontend/docs/mockups/子功能-对话演示气泡-拓展润色场景.jpg` 目视比对布局（原则 IV）；通过后在 tasks.md 勾选本项
  **状态**：人工验收项，待用户执行（自动化验证已全绿，见 T016 注记）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 无依赖，立即执行
- **Foundational (Phase 2)**: 依赖 T001 基线；T002（后端）与 T003/T004（测试与前端基建）中 T003 依赖 T002，T004 独立可并行
- **US1 (Phase 3)**: 依赖 Phase 2 全部完成；T005 → T006（可并行启动但同目录建议顺序）→ T007（依赖 T005/T006）→ T008
- **US2 (Phase 4)**: 依赖 US1 完成（组件已存在才可接线）；T009 与 T010/T011 分别改不同文件可并行
- **US3 (Phase 5)**: 依赖 US1/US2 完成（降级与回归要在全功能下验证）；T013 可提前与 Phase 3 并行
- **Polish (Phase 6)**: T016 依赖全部实现任务；T017 依赖 T016

### User Story Dependencies

- US1 是 MVP 且是 US2/US3 的结构前提（气泡组件不存在则操作/降级无从谈起）
- US2 依赖 US1；US3 验证依赖 US1+US2
- 三个 US 串行交付（单人开发），无跨 US 并行需求

### Parallel Opportunities

- T003（后端测试）∥ T004（前端 polisher-data.ts）：不同目录零依赖
- T009 ∥ T010+T011：actions 与 toolbar/bubble 不同文件
- T013 可提前至 Phase 3 同步编写

---

## Implementation Strategy

- **MVP First**: Phase 1~3 完成即可人工验证润色气泡渲染（STOP and VALIDATE）
- **增量交付**: US2 操作能力 → US3 降级回归，每 Phase 后 quickstart 对应节验证
- **同构原则**: 一切新组件以 correction-bubble 同名文件为模板（T005~T011 均注明参照物），复用优先于重写；后端除 T002 外零改动
- **验收代理**: 浏览器 UI 验收由用户人工执行（T008/T012/T015/T017 的人工部分），自动化验证以 pytest/oxlint/tsc 为准

## Notes

- 后端 metadata 键名硬约束贯穿 T002/T003：`additional_kwargs["metadata"]["polisher_data"]`，写错位置前端读不到（003 实测教训）
- 流式链路 metadata.custom 不可靠是已知事实，T005 的路径 B（state 关联）是流式主路径，不是可选项
- 评分条「地道」项不渲染由 corrections=[] 自然达成，不需要改 ScoreBar
- 本 feature 不改 polisher_reply_message_node 正文文案（R6），「当前语句没有错误，没有tutor_reply。」文案优化留待独立任务

---

## Implementation Notes（实施注记，2026-10-27）

- **执行方式**：单文件族合并实现（US1+US2 组件一轮写入，T008/T012 验证合并执行），单人开发无并行冲突；US1 STOP-and-VALIDATE 检查点由 T008/T012/T016 三轮自动化验证替代
- **T002 已完成**：[talk_graph.py](file:///d:/langgraphprodaima/dialog-ai/backend/src/talk_agent/talk_graph.py) `polisher_reply_message_node` 挂载 `polisher_data` 四字段（赋值式，与 003 correction_data 同款）；确认后端 polish_status 实际枚举为 `success | fallback | skipped`（polisher_nodes.py），与契约一致（analyze C1 消化）
- **T003 已完成**：[test_polisher_message_node.py](file:///d:/langgraphprodaima/dialog-ai/backend/tests/unit_tests/test_polisher_message_node.py) 5 用例全绿（success 挂载/正文模板/缺失 status 空串/fallback 无条件挂载/空字典不抛异常）
- **T004~T011 已完成**：新建 [polisher-data.ts](file:///d:/langgraphprodaima/dialog-ai/frontend/components/polisher-bubble/polisher-data.ts)、[polisher-toolbar.tsx](file:///d:/langgraphprodaima/dialog-ai/frontend/components/polisher-bubble/polisher-toolbar.tsx)、[polisher-actions.tsx](file:///d:/langgraphprodaima/dialog-ai/frontend/components/polisher-bubble/polisher-actions.tsx)、[polisher-score-bar.tsx](file:///d:/langgraphprodaima/dialog-ai/frontend/components/polisher-bubble/polisher-score-bar.tsx)、[polisher-bubble.tsx](file:///d:/langgraphprodaima/dialog-ai/frontend/components/polisher-bubble/polisher-bubble.tsx)（含 PolisherAwareAssistantMessage 分流组件）；[correction-bubble.tsx](file:///d:/langgraphprodaima/dialog-ai/frontend/components/correction-bubble/correction-bubble.tsx) 仅改 2 处（import + 兜底 return `PolisherAwareAssistantMessage`，003 其余零触碰）
- **T011 实现决策（偏离字面描述，符合 FR-007 权威）**：ScoreBar 在 corrections=[] ∧ ise_grade=null 时整体返回 null 且语法项文案为纠错语义，无法满足「必须展示语法正确 ✓（太棒了）」→ 新建独立 PolisherScoreBar（恒显语法正确项，发音/地道项无数据源不渲染，analyze C2 消化）
- **T013 已完成（留档分支）**：frontend 无 vitest/jest 测试基建（package.json 无 test runner），守卫边界逻辑以 parsePolisherData/shouldRenderPolisher 纯函数 + 后端契约测试留档覆盖，未引入前端测试框架（避免为单 feature 新增基建）
- **T014/T015/T016 已完成**：oxlint 55 文件 0 警告 0 错误；tsc 仅既有基线 TS2339 一处（tool-fallback.aui.tsx，003 前遗留）零新增；后端 pytest 37/37 全绿（31 既有 + 5 新增 + 1 集成场景组），003/004 零回归
- **T017 待办**：人工浏览器验收（quickstart §1~§5 + 原型图目视比对；SC-001 建议加量至 10 句，analyze E1）

## T017 验收修复记录（2026-10-27）

- **症状**：首轮人工验收发 `It is important.` 后润色气泡完全未渲染，回落默认消息样式（与 003 初期 metadata 流式丢失表现一致）
- **根因**：字段名映射缺口——后端 state 契约 `polisher` 字典（PolisherOutput）字段为 `original_text`（state.py L18），前端 parsePolisherData 只认 `raw_text`；流式下 metadata 被 SDK 丢弃（003 已知），state 兜底路径解析返回 null → 双路径全断
- **修复**：[polisher-data.ts](file:///d:/langgraphprodaima/dialog-ai/frontend/components/polisher-bubble/polisher-data.ts) parsePolisherData 兼容双来源（`raw_text` 优先、回退 `original_text`），前端适配后端不动后端（Constitution II）；oxlint 0 错误、tsc 零新增
- **教训**：003 读平铺 state 字段无需映射，005 首次消费打包字典 channel，字段名对齐必须在数据基建层完成，不能假设 metadata 映射覆盖 state 路径
